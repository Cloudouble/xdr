class Type {

    toJSON() {
        return this.value ? this.value : null
    }

    toString() {
        return this.value ? `${this.value}` : 'undefined'
    }

    valueOf() {
        return this.value
    }

}

class intType extends Type {
    #bytes
    #unsigned
    #value
    constructor(input, unsigned) {
        super()
        if (input instanceof Uint8Array) {
            if (input.length !== 4) throw new Error('int type must have byte length of 4')
            this.bytes = input
            this.#unsigned = !!unsigned
        } else if (Number.isInteger(input)) {
            this.#value = input
            this.#unsigned = input >= 0
        }
    }

    get bytes() {
        if (!this.#bytes) {
            const buffer = new ArrayBuffer(4), view = new DataView(buffer)
            this.#unsigned ? view.setUint32(0, this.value, false) : view.setInt32(0, this.value, false)
            this.#bytes = new Uint8Array(buffer)
        }
        return this.#bytes
    }

    get value() {
        if (this.#value === undefined) {
            const view = new DataView(this.#bytes.buffer)
            this.#value = this.#unsigned ? view.getUint32(0, false) : view.getInt32(0, false)
        }
        return this.#value
    }

}

class enumType extends intType {
    #mapping = {}
    #name
    constructor(input, mapping) {
        if (!mapping || (typeof mapping !== 'object')
            || !Object.keys(mapping).length || !Object.values(mapping).every(v => Number.isInteger(v) && (v >= 0))) throw new Error('enum must have a mapping object')
        if (!(input in mapping)) throw new Error(`enum value ${input} not found in mapping`)
        super(mapping[input], true)
        this.#name = input
    }
    get name() { return this.#name }
}

class boolType extends enumType {
    constructor(input) {
        input = !!input
        super(input, { true: 1, false: 0 })
    }
}


export default {

    int: intType,
    enum: enumType,
    bool: boolType,

    serialize: function (value) {
        let buffer, view
        switch (typeof value) {
            case 'undefined':
                return new Uint8Array(0)
            case 'bigint':
                buffer = new ArrayBuffer(16)
                view = new DataView(buffer)
                view.setBigUint64(0, BigInt.asUintN(64, value), false)
                view.setBigUint64(8, BigInt.asUintN(64, value >> 64n), false)
                break
            case 'boolean':
                buffer = new ArrayBuffer(4)
                view = new DataView(buffer)
                view.setUint32(0, value ? 1 : 0, false)
                break
            case 'number':
                if (Number.isInteger(value)) {
                    if (value >= 0) {
                        // unsigned integer
                        buffer = new ArrayBuffer(4)
                        view = new DataView(buffer)
                        view.setUint32(0, value, false)
                    } else {
                        // signed integer
                        buffer = new ArrayBuffer(4)
                        view = new DataView(buffer)
                        view.setInt32(0, value, false)
                    }
                } else {
                    if (Math.fround(value) === value) {
                        // single-precision floating point
                        buffer = new ArrayBuffer(4)
                        view = new DataView(buffer)
                        view.setFloat32(0, value, false)
                    } else if (Number.isFinite(value)) {
                        // double-precision floating point
                        buffer = new ArrayBuffer(8)
                        view = new DataView(buffer)
                        view.setFloat64(0, value, false)
                    } else {
                        // quadruple-precision floating point
                        throw new Error('Quadruple-precision floating point is not supported')
                    }
                }
                break
            case 'string':
                const encoder = new TextEncoder()
                const encodedValue = encoder.encode(value)
                const valueLength = encodedValue.length
                buffer = new ArrayBuffer(4 + Math.ceil(valueLength / 4) * 4)
                view = new DataView(buffer)
                view.setUint32(0, valueLength, false)
                const uint8Array = new Uint8Array(buffer, 4)
                uint8Array.set(encodedValue)
                break
            case 'object':
                if (value === null) {
                    return new Uint8Array(0)
                }
                if (Array.isArray(value)) {
                    const serializedArray = value.map(item => this.serialize(item))
                    const totalLength = serializedArray.reduce((acc, arr) => acc + arr.length, 0)
                    buffer = new ArrayBuffer(4 + totalLength)
                    view = new DataView(buffer)
                    view.setUint32(0, value.length, false)
                    let offset = 4
                    for (const arr of serializedArray) {
                        const uint8Array = new Uint8Array(buffer, offset)
                        uint8Array.set(arr)
                        offset += arr.length
                    }
                } else {
                    const entries = Object.entries(value)
                    const serializedEntries = entries.map(([key, val]) => {
                        const serializedKey = this.serialize(key)
                        const serializedValue = this.serialize(val)
                        return new Uint8Array([...serializedKey, ...serializedValue])
                    })
                    const totalLength = serializedEntries.reduce((acc, arr) => acc + arr.length, 0)
                    buffer = new ArrayBuffer(4 + totalLength)
                    view = new DataView(buffer)
                    view.setUint32(0, entries.length, false)
                    let offset = 4
                    for (const arr of serializedEntries) {
                        const uint8Array = new Uint8Array(buffer, offset)
                        uint8Array.set(arr)
                        offset += arr.length
                    }
                }
                break
            default:
                throw new Error(`Unsupported type: ${typeof value}`)
        }
        return new Uint8Array(buffer)
    },
    deserialize: function (buffer, typeDefinition) {
        try {
            if (!(buffer instanceof ArrayBuffer)) buffer = (new Uint8Array(Array.from(buffer))).buffer
        } catch (e) {
            throw new Error(`Invalid buffer: ${buffer}`)
        }
        let view = new DataView(buffer), value
        if (view.byteLength % 4) throw new Error(`Invalid XDR buffer length: ${view.byteLength}`)
        if (!typeDefinition) {
            switch (view.byteLength) {
                case 0:
                    return null
                case 4:
                    value = view.getUint32(0, false)
                    switch (value) {
                        case 0:
                            return false
                        case 1:
                            return true
                        default:
                            return value
                    }
                default:
                    let offset = 0
                    const flagLength = view.getUint32(offset, false), flagBlockLength = Math.ceil(flagLength / 4) * 4, flagChars = []
                    offset += 4
                    const flagEnd = offset + flagLength, bodyOffset = offset + flagBlockLength
                    typeDefinition = String.fromCharCode(...(new Uint8Array(buffer, 4, flagLength)))
                    if (view.byteLength === bodyOffset) return typeDefinition
                    buffer = buffer.slice(bodyOffset)
                    view = new DataView(buffer)
            }
        }
        typeDefinition = typeDefinition.trim()
        switch (typeDefinition) {
            case 'void':
                if (buffer.byteLength) throw new Error('Void type must be empty')
                return null
            case 'int':
                if (buffer.byteLength !== 4) throw new Error('int type must have byte length of 4')
                return view.getInt32(0, false)
            case 'unsigned int':
                if (buffer.byteLength !== 4) throw new Error('unsigned int type must have byte length of 4')
                return view.getUint32(0, false)
            case 'bool':
                if (buffer.byteLength !== 4) throw new Error('bool type must have byte length of 4')
                return view.getUint32(0, false) !== 0
            case 'hyper':
                if (buffer.byteLength !== 8) throw new Error('hyper type must have byte length of 8')
                const highBits = view.getInt32(0, false)
                const lowBits = view.getUint32(4, false)
                return BigInt(highBits) << 32n | BigInt(lowBits)
            case 'unsigned hyper':
                if (buffer.byteLength !== 8) throw new Error('unsigned hyper type must have byte length of 8')
                const highBitsUnsigned = view.getUint32(0, false)
                const lowBitsUnsigned = view.getUint32(4, false)
                return BigInt(highBitsUnsigned) << 32n | BigInt(lowBitsUnsigned)
            case 'float':
                if (buffer.byteLength !== 4) throw new Error('float type must have byte length of 4')
                return view.getFloat32(0, false)
            case 'double':
                if (buffer.byteLength !== 8) throw new Error('double type must have byte length of 8')
                return view.getFloat64(0, false)
            case 'quadruple':
                throw new Error('quadruple type is not supported');
            case 'opaque':
                const opaqueLength = view.getUint32(0, false), opaqueBufferLength = 4 + (Math.ceil(opaqueLength / 4) * 4)
                if (buffer.byteLength !== opaqueBufferLength) throw new Error(`opaque type must have byte length of ${opaqueBufferLength}`)
                return new Uint8Array(buffer, 4, opaqueLength)
            case 'string':
                const stringLength = view.getUint32(0, false), stringBufferLength = 4 + (Math.ceil(stringLength / 4) * 4), chars = []
                if (buffer.byteLength !== stringBufferLength) throw new Error(`string type must have byte length of ${stringBufferLength}`)
                return String.fromCharCode(...(new Uint8Array(buffer, 4, stringLength)))
            case 'object':
                value = {}
                let offset = 0
                while (offset < buffer.byteLength) {
                    const fieldNameLength = view.getUint32(offset, false)
                    offset += 4
                    const fieldNameBuffer = new Uint8Array(buffer, offset, fieldNameLength)
                    offset += Math.ceil(fieldNameLength / 4) * 4
                    const fieldName = String.fromCharCode(...fieldNameBuffer), fieldTypeLength = view.getUint32(offset, false)
                    offset += 4
                    const fieldTypeBuffer = new Uint8Array(buffer, offset, fieldTypeLength)
                    offset += Math.ceil(fieldTypeLength / 4) * 4
                    const fieldType = String.fromCharCode(...fieldTypeBuffer), fieldSize = getFieldSize(fieldType),
                        fieldBuffer = buffer.slice(offset, offset + fieldSize), fieldValue = this.deserialize(fieldBuffer, fieldType)
                    value[fieldName] = fieldValue
                    offset += fieldSize
                }
                return value
            default:
            // type definition in the form of a string XDR data description



        }

        return [typeDefinition, new Uint8Array(buffer)]

    },
    parse: function (str) {
        const s = []
        for (const b in atob(str)) s.push(b.charCodeAt())
        return s
    },
    stringify: function (value) {
        const s = []
        const serializedValue = this.serialize(value)
        for (const b of serializedValue) s.push(String.fromCharCode(b))
        return btoa(s.join(''))
    },
    registerType: function () { },





    // Type: class {
    //     constructor(X) {
    //         Object.defineProperties(this, {
    //             constants: { value: {} },
    //             enums: { value: {} },
    //             types: { value: {} },
    //             struct: { value: [] },
    //             X: { value: X }
    //         })
    //         this.types = SimpleXdr.compileTypeDefinition()
    //     }
    //     compileTypeDefinition() {
    //         const X = this.X
    //         if (!X) return
    //         const lines = X.split('\n'), definitions = {}
    //         let currentType = null, currentEnum = null, currentStruct = null, currentUnion = null,
    //             currentlyCommentedLine = false
    //         for (let line of lines) {
    //             line = line.trim()
    //             if (!line) continue
    //             if (currentlyCommentedLine) {
    //                 if (line.endsWith('*/')) currentlyCommentedLine = false
    //                 continue
    //             } else if (line.startsWith('/*')) {
    //                 currentlyCommentedLine = true
    //                 continue
    //             }
    //             if (line.startsWith('typedef')) {
    //                 const [, declaration] = line.split('typedef').map(part => part.trim());
    //                 const [typeSpecifier, identifier] = declaration.split(/\s+/);
    //                 definitions[identifier] = typeSpecifier;
    //             } else if (line.startsWith('enum')) {
    //                 const [, identifier, enumBody] = line.split(/enum|\{|\}/).map(part => part.trim());
    //                 currentEnum = identifier;
    //                 definitions[currentEnum] = {};
    //             } else if (line.startsWith('struct')) {
    //                 const [, identifier, structBody] = line.split(/struct|\{|\}/).map(part => part.trim());
    //                 currentStruct = identifier;
    //                 definitions[currentStruct] = {};
    //             } else if (line.startsWith('union')) {
    //                 const [, identifier, unionBody] = line.split(/union|\{|\}/).map(part => part.trim());
    //                 currentUnion = identifier;
    //                 definitions[currentUnion] = {};
    //             } else if (line.startsWith('}')) {
    //                 currentType = null;
    //             } else if (currentEnum && line.includes('=')) {
    //                 const [enumIdentifier, enumValue] = line.split('=').map(part => part.trim());
    //                 definitions[currentEnum][enumIdentifier] = parseInt(enumValue);
    //             } else if (currentStruct) {
    //                 const [typeSpecifier, identifier] = line.split(/\s+/);
    //                 definitions[currentStruct][identifier] = typeSpecifier.endsWith(';') ? typeSpecifier.slice(0, -1) : typeSpecifier;
    //             } else if (currentUnion) {
    //                 // TODO: Handle union cases
    //             }
    //         }

    //         return definitions;
    //     }


    //     toString() {
    //         return this.#typeDefinition
    //     }

    //     valueOf() {

    //     }

    // }
}

// sampleTypeDefinitionObject = {
//     constants: {
//         MAXUSERNAME: 32,
//         MAXFILELEN: 65535,
//         MAXNAMELEN: 255
//     },
//     enums: {
//         filekind: ["TEXT", "DATA", "EXEC"]
//     },
//     types: {
//         filetype: {
//             enum: this.enums.filekind,
//             switch: {
//                 TEXT: [{ type: "void" }],
//                 DATA: [{ type: "string", "max": this.constants.MAXNAMELEN, identifier: "creator" }],
//                 EXEC: [{ type: "string", "max": this.constants.MAXNAMELEN, identifier: "interpretor" }]
//             }
//         }
//     },
//     struct: [
//         { type: "string", "max": this.constants.MAXNAMELEN, identifier: "filename" },
//         { type: this.types.filetype, identifier: "type" },
//         { type: "string", "max": this.constants.MAXUSERNAME, identifier: "owner" },
//         { type: "opaque", "max": this.constants.MAXFILELEN, identifier: "data" }
//     ]
// }

// sampleObject = {
//     filename: "sillyprog",
//     type: "EXEC",
//     interpretor: "lisp",
//     owner: "john",
//     data: [28, 71, 75, 59, 74, 29]
// }
