class TypeDef {

    #bytes
    #value

    static serialize(value, instance) {

    }

    static deserialize(bytes, instance) {

    }

    static isValidInput(input) {
        return input instanceof Object
    }

    constructor(input) {
        super()
        if (!(input instanceof Uint8Array) && Array.isArray(input)) input = new Uint8Array(input)
        if (input instanceof Uint8Array) {
            const paddedLength = Math.ceil(input.length / 4) * 4
            this.#bytes = new Uint8Array(paddedLength)
            this.#bytes.set(input)
        } else if (this.constructor.isValidInput(input)) {
            this.#value = input
        }
    }

    get bytes() {
        this.#bytes ??= this.constructor.serialize.bind(this)(this.#value)
        return this.#bytes
    }

    get value() {
        this.#value ??= this.constructor.deserialize.bind(this)(this.#bytes)
        return this.#value
    }

    toJSON() {
        return this.value ? this.value : null
    }

    toString() {
        try {
            return this.value ? JSON.stringify(this.value) : 'null'
        } catch (e) {
            throw new Error(`Error converting ${this.constructor.name} to string: ${e.message}`, { cause: e })
        }
    }

    valueOf() {
        return this.value
    }

}

class intType extends TypeDef {

    static isValidInput(input) {
        return Number.isInteger(input)
    }

    static serialize(value) {
        const buffer = new ArrayBuffer(4), view = new DataView(buffer)
        this.unsigned ? view.setUint32(0, value, false) : view.setInt32(0, value, false)
        return new Uint8Array(buffer)
    }

    static deserialize(bytes) {
        const view = new DataView(bytes.buffer)
        return this.unsigned ? view.getUint32(0, false) : view.getInt32(0, false)
    }

    constructor(input, unsigned) {
        if (input?.length !== 4) throw new Error('int type must have byte length of 4')
        super(input)
        this.unsigned = this.constructor.isValidInput(input) ? input >= 0 : !!unsigned
    }

}

class enumType extends intType {
    #map
    #name
    constructor(name, map) {
        if (!map || (typeof map !== 'object')
            || !Object.keys(map).length || !Object.values(map).every(v => Number.isInteger(v) && (v >= 0))) throw new Error('enum must have a mapping object')
        if (!(name in map)) throw new Error(`enum name ${name} not found in map`)
        super(map[name], true)
        this.#name = name
        this.#map = { ...map }
    }
    get name() { return this.#name }
    get map() { return this.#map }
}

class boolType extends enumType {
    constructor(input) {
        input = !!input
        super(input, { true: 1, false: 0 })
    }
}

class hyperType extends TypeDef {

    static isValidInput(input) {
        return typeof input === 'bigint'
    }

    static serialize(value) {
        const buffer = new ArrayBuffer(8), view = new DataView(buffer)
        view.setBigUint64(0, BigInt.asUintN(64, value), false)
        return new Uint8Array(buffer)
    }

    static deserialize(bytes) {
        const view = new DataView(bytes.buffer)
        return this.unsigned ? view.getBigUint64(0, false) : view.getBigInt64(0, false)
    }

    constructor(input, unsigned) {
        if (input?.length !== 8) throw new Error('hyper type must have byte length of 8')
        super(input)
        this.unsigned = this.constructor.isValidInput(input) ? input >= 0n : !!unsigned
    }

    toJSON() {
        return this.value ? `${this.value}` : null
    }

}

class floatType extends TypeDef {

    static isValidInput(input) {
        return typeof input === 'number'
    }

    static serialize(value) {
        const buffer = new ArrayBuffer(4), view = new DataView(buffer)
        view.setFloat32(0, value, false)
        return new Uint8Array(buffer)
    }

    static deserialize(bytes) {
        const view = new DataView(bytes.buffer)
        return view.getFloat32(0, false)
    }

    constructor(input, unsigned) {
        if (input?.length !== 4) throw new Error('float type must have byte length of 4')
        super(input)
    }

}

class doubleType extends TypeDef {

    static isValidInput(input) {
        return typeof input === 'number'
    }

    static serialize(value) {
        const buffer = new ArrayBuffer(8), view = new DataView(buffer)
        view.setFloat64(0, value, false)
        return new Uint8Array(buffer)
    }

    static deserialize(bytes) {
        const view = new DataView(bytes.buffer)
        return view.getFloat64(0, false)
    }

    constructor(input, unsigned) {
        if (input?.length !== 8) throw new Error('double type must have byte length of 8')
        super(input)
    }

}

class opaqueType extends TypeDef {

    #length
    #variable

    static isValidInput(input) {
        return Array.isArray(input)
    }

    static serialize(value) {
        const paddedLength = Math.ceil((this.variable ? value.length : this.length) / 4) * 4
        const bytes = new Uint8Array(this.variable ? (4 + paddedLength) : paddedLength)
        if (this.variable) {
            const buffer = new ArrayBuffer(4), view = new DataView(buffer)
            view.setUint32(0, value.length, false)
            bytes.set(new Uint8Array(buffer))
        }
        bytes.set(input, variable ? 4 : 0)
        return bytes
    }

    static deserialize(bytes) {
        return Array.from(bytes)
    }

    constructor(input, variable, length) {
        super(input)
        if (length && (input.length > length)) throw new Error(`opaque type must have byte length less than or equal to ${length}`)
        length ||= input.length
        this.#length = length
        this.#variable = variable
    }

    get length() {
        return this.#length
    }

    get variable() {
        return this.#variable
    }

}

class stringType extends TypeDef {

    #maxLength

    static isValidInput(input) {
        return typeof input === 'string'
    }

    static serialize(value) {
        const paddedLength = Math.ceil(value.length / 4) * 4
        const bytes = new Uint8Array(4 + paddedLength)
        const buffer = new ArrayBuffer(4), view = new DataView(buffer)
        view.setUint32(0, value.length, false)
        bytes.set(new Uint8Array(buffer))
        bytes.set((new TextEncoder()).encode(value), 4)
        return bytes
    }

    static deserialize(bytes) {
        const view = new DataView(bytes.buffer), stringLength = view.getUint32(0, false)
        return String.fromCharCode(...(new Uint8Array(bytes.buffer, 4, stringLength)))
    }

    constructor(input, maxLength) {
        super(input)
        if (maxLength && (this.value > maxLength)) throw new Error(`string type must have maximum byte length of ${maxLength}`)
    }

    get maxLength() {
        return this.#maxLength
    }

}

class voidType extends TypeDef {

    static isValidInput(input) {
        return input == null
    }

    static serialize(value) {
        return new Uint8Array(0)
    }

    static deserialize(bytes) {
        return null
    }

    constructor(input) {
        if (input != null) throw new Error('void type must be nullish or a zero length array')
        super(input)
    }

}

const XDR = {
    typedef: TypeDef,
    int: intType,
    enum: enumType,
    bool: boolType,
    hyper: hyperType,
    float: floatType,
    double: doubleType,
    opaque: opaqueType,
    string: stringType,
    void: voidType
}

export default XDR

export function X(xCode) {
    if (!xCode || (typeof xCode !== 'string')) return
    const lines = xCode.split('\n'), definitions = {}
    let currentType = null, currentEnum = null, currentStruct = null, currentUnion = null,
        currentlyCommentedLine = false
    for (let line of lines) {
        line = line.trim()
        if (!line) continue
        if (currentlyCommentedLine) {
            if (line.endsWith('*/')) currentlyCommentedLine = false
            continue
        } else if (line.startsWith('/*')) {
            currentlyCommentedLine = true
            continue
        }


        if (line.startsWith('typedef')) {
            const [, declaration] = line.split('typedef').map(part => part.trim());
            const [typeSpecifier, identifier] = declaration.split(/\s+/);
            definitions[identifier] = typeSpecifier;
        } else if (line.startsWith('enum')) {
            const [, identifier, enumBody] = line.split(/enum|\{|\}/).map(part => part.trim());
            currentEnum = identifier;
            definitions[currentEnum] = {};
        } else if (line.startsWith('struct')) {
            const [, identifier, structBody] = line.split(/struct|\{|\}/).map(part => part.trim());
            currentStruct = identifier;
            definitions[currentStruct] = {};
        } else if (line.startsWith('union')) {
            const [, identifier, unionBody] = line.split(/union|\{|\}/).map(part => part.trim());
            currentUnion = identifier;
            definitions[currentUnion] = {};
        } else if (line.startsWith('}')) {
            currentType = null;
        } else if (currentEnum && line.includes('=')) {
            const [enumIdentifier, enumValue] = line.split('=').map(part => part.trim());
            definitions[currentEnum][enumIdentifier] = parseInt(enumValue);
        } else if (currentStruct) {
            const [typeSpecifier, identifier] = line.split(/\s+/);
            definitions[currentStruct][identifier] = typeSpecifier.endsWith(';') ? typeSpecifier.slice(0, -1) : typeSpecifier;
        } else if (currentUnion) {
            // TODO: Handle union cases
        }

    }

    return class extends TypeDef {



    }

}









// serialize: function (value) {
//     let buffer, view
//     switch (typeof value) {
//         case 'undefined':
//             return new Uint8Array(0)
//         case 'bigint':
//             buffer = new ArrayBuffer(16)
//             view = new DataView(buffer)
//             view.setBigUint64(0, BigInt.asUintN(64, value), false)
//             view.setBigUint64(8, BigInt.asUintN(64, value >> 64n), false)
//             break
//         case 'boolean':
//             buffer = new ArrayBuffer(4)
//             view = new DataView(buffer)
//             view.setUint32(0, value ? 1 : 0, false)
//             break
//         case 'number':
//             if (Number.isInteger(value)) {
//                 if (value >= 0) {
//                     // unsigned integer
//                     buffer = new ArrayBuffer(4)
//                     view = new DataView(buffer)
//                     view.setUint32(0, value, false)
//                 } else {
//                     // signed integer
//                     buffer = new ArrayBuffer(4)
//                     view = new DataView(buffer)
//                     view.setInt32(0, value, false)
//                 }
//             } else {
//                 if (Math.fround(value) === value) {
//                     // single-precision floating point
//                     buffer = new ArrayBuffer(4)
//                     view = new DataView(buffer)
//                     view.setFloat32(0, value, false)
//                 } else if (Number.isFinite(value)) {
//                     // double-precision floating point
//                     buffer = new ArrayBuffer(8)
//                     view = new DataView(buffer)
//                     view.setFloat64(0, value, false)
//                 } else {
//                     // quadruple-precision floating point
//                     throw new Error('Quadruple-precision floating point is not supported')
//                 }
//             }
//             break
//         case 'string':
//             const encoder = new TextEncoder()
//             const encodedValue = encoder.encode(value)
//             const valueLength = encodedValue.length
//             buffer = new ArrayBuffer(4 + Math.ceil(valueLength / 4) * 4)
//             view = new DataView(buffer)
//             view.setUint32(0, valueLength, false)
//             const uint8Array = new Uint8Array(buffer, 4)
//             uint8Array.set(encodedValue)
//             break
//         case 'object':
//             if (value === null) {
//                 return new Uint8Array(0)
//             }
//             if (Array.isArray(value)) {
//                 const serializedArray = value.map(item => this.serialize(item))
//                 const totalLength = serializedArray.reduce((acc, arr) => acc + arr.length, 0)
//                 buffer = new ArrayBuffer(4 + totalLength)
//                 view = new DataView(buffer)
//                 view.setUint32(0, value.length, false)
//                 let offset = 4
//                 for (const arr of serializedArray) {
//                     const uint8Array = new Uint8Array(buffer, offset)
//                     uint8Array.set(arr)
//                     offset += arr.length
//                 }
//             } else {
//                 const entries = Object.entries(value)
//                 const serializedEntries = entries.map(([key, val]) => {
//                     const serializedKey = this.serialize(key)
//                     const serializedValue = this.serialize(val)
//                     return new Uint8Array([...serializedKey, ...serializedValue])
//                 })
//                 const totalLength = serializedEntries.reduce((acc, arr) => acc + arr.length, 0)
//                 buffer = new ArrayBuffer(4 + totalLength)
//                 view = new DataView(buffer)
//                 view.setUint32(0, entries.length, false)
//                 let offset = 4
//                 for (const arr of serializedEntries) {
//                     const uint8Array = new Uint8Array(buffer, offset)
//                     uint8Array.set(arr)
//                     offset += arr.length
//                 }
//             }
//             break
//         default:
//             throw new Error(`Unsupported type: ${typeof value}`)
//     }
//     return new Uint8Array(buffer)
// },
// deserialize: function (buffer, typeDefinition) {
//     try {
//         if (!(buffer instanceof ArrayBuffer)) buffer = (new Uint8Array(Array.from(buffer))).buffer
//     } catch (e) {
//         throw new Error(`Invalid buffer: ${buffer}`)
//     }
//     let view = new DataView(buffer), value
//     if (view.byteLength % 4) throw new Error(`Invalid XDR buffer length: ${view.byteLength}`)
//     if (!typeDefinition) {
//         switch (view.byteLength) {
//             case 0:
//                 return null
//             case 4:
//                 value = view.getUint32(0, false)
//                 switch (value) {
//                     case 0:
//                         return false
//                     case 1:
//                         return true
//                     default:
//                         return value
//                 }
//             default:
//                 let offset = 0
//                 const flagLength = view.getUint32(offset, false), flagBlockLength = Math.ceil(flagLength / 4) * 4, flagChars = []
//                 offset += 4
//                 const flagEnd = offset + flagLength, bodyOffset = offset + flagBlockLength
//                 typeDefinition = String.fromCharCode(...(new Uint8Array(buffer, 4, flagLength)))
//                 if (view.byteLength === bodyOffset) return typeDefinition
//                 buffer = buffer.slice(bodyOffset)
//                 view = new DataView(buffer)
//         }
//     }
//     typeDefinition = typeDefinition.trim()
//     switch (typeDefinition) {
//         case 'void':
//             if (buffer.byteLength) throw new Error('Void type must be empty')
//             return null
//         case 'int':
//             if (buffer.byteLength !== 4) throw new Error('int type must have byte length of 4')
//             return view.getInt32(0, false)
//         case 'unsigned int':
//             if (buffer.byteLength !== 4) throw new Error('unsigned int type must have byte length of 4')
//             return view.getUint32(0, false)
//         case 'bool':
//             if (buffer.byteLength !== 4) throw new Error('bool type must have byte length of 4')
//             return view.getUint32(0, false) !== 0
//         case 'hyper':
//             if (buffer.byteLength !== 8) throw new Error('hyper type must have byte length of 8')
//             const highBits = view.getInt32(0, false)
//             const lowBits = view.getUint32(4, false)
//             return BigInt(highBits) << 32n | BigInt(lowBits)
//         case 'unsigned hyper':
//             if (buffer.byteLength !== 8) throw new Error('unsigned hyper type must have byte length of 8')
//             const highBitsUnsigned = view.getUint32(0, false)
//             const lowBitsUnsigned = view.getUint32(4, false)
//             return BigInt(highBitsUnsigned) << 32n | BigInt(lowBitsUnsigned)
//         case 'float':
//             if (buffer.byteLength !== 4) throw new Error('float type must have byte length of 4')
//             return view.getFloat32(0, false)
//         case 'double':
//             if (buffer.byteLength !== 8) throw new Error('double type must have byte length of 8')
//             return view.getFloat64(0, false)
//         case 'quadruple':
//             throw new Error('quadruple type is not supported');
//         case 'opaque':
//             const opaqueLength = view.getUint32(0, false), opaqueBufferLength = 4 + (Math.ceil(opaqueLength / 4) * 4)
//             if (buffer.byteLength !== opaqueBufferLength) throw new Error(`opaque type must have byte length of ${opaqueBufferLength}`)
//             return new Uint8Array(buffer, 4, opaqueLength)
//         case 'string':
//             const stringLength = view.getUint32(0, false), stringBufferLength = 4 + (Math.ceil(stringLength / 4) * 4), chars = []
//             if (buffer.byteLength !== stringBufferLength) throw new Error(`string type must have byte length of ${stringBufferLength}`)
//             return String.fromCharCode(...(new Uint8Array(buffer, 4, stringLength)))
//         case 'object':
//             value = {}
//             let offset = 0
//             while (offset < buffer.byteLength) {
//                 const fieldNameLength = view.getUint32(offset, false)
//                 offset += 4
//                 const fieldNameBuffer = new Uint8Array(buffer, offset, fieldNameLength)
//                 offset += Math.ceil(fieldNameLength / 4) * 4
//                 const fieldName = String.fromCharCode(...fieldNameBuffer), fieldTypeLength = view.getUint32(offset, false)
//                 offset += 4
//                 const fieldTypeBuffer = new Uint8Array(buffer, offset, fieldTypeLength)
//                 offset += Math.ceil(fieldTypeLength / 4) * 4
//                 const fieldType = String.fromCharCode(...fieldTypeBuffer), fieldSize = getFieldSize(fieldType),
//                     fieldBuffer = buffer.slice(offset, offset + fieldSize), fieldValue = this.deserialize(fieldBuffer, fieldType)
//                 value[fieldName] = fieldValue
//                 offset += fieldSize
//             }
//             return value
//         default:
//         // type definition in the form of a string XDR data description



//     }

//     return [typeDefinition, new Uint8Array(buffer)]

// },
// parse: function (str) {
//     const s = []
//     for (const b in atob(str)) s.push(b.charCodeAt())
//     return s
// },
// stringify: function (value) {
//     const s = []
//     const serializedValue = this.serialize(value)
//     for (const b of serializedValue) s.push(String.fromCharCode(b))
//     return btoa(s.join(''))
// },
// registerType: function () { },





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
