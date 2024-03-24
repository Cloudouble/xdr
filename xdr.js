class TypeDef {

    #bytes
    #value

    static minBytesLength = 0

    static serialize(value) { return new Uint8Array() }

    static deserialize(bytes) { return }

    static getView(i) {
        if (typeof i === 'number') return new DataView(new ArrayBuffer(i))
        if (i instanceof Uint8Array) return new DataView(i.buffer, i.byteOffset, i.byteLength)
    }

    static isValueInput(input) { return input && !(input instanceof Uint8Array) && (input instanceof Object) }

    static isMinBytesInput(bytes) { return Number.isInteger(this.minBytesLength) ? (bytes.length >= this.minBytesLength) : true }

    constructor(input, ...consumeArgs) {
        if (!(input instanceof Uint8Array) && Array.isArray(input) && input.every(i => Number.isInteger(i) && (i >= 0) && (i <= 255))) input = new Uint8Array(input)
        if (input instanceof Uint8Array) {
            this.#bytes = this.#consume(input, ...consumeArgs)
        } else if (this.constructor.isValueInput(input)) {
            this.#value = input
        } else {
            throw new Error(`Invalid input for ${this.constructor.name}: ${input}`)
        }
    }

    consume(bytes) { return bytes.subarray(0, this.constructor.minBytesLength) }

    get bytes() { return this.#bytes ??= this.constructor.serialize.bind(this)(this.#value) }

    get value() { return this.#value ??= this.constructor.deserialize.bind(this)(this.#bytes) }

    toJSON() { return this.value ? this.value : null }

    toString() {
        try {
            return this.value ? JSON.stringify(this.value) : 'null'
        } catch (e) {
            throw new Error(`Error converting ${this.constructor.name} to string: ${e.message}`, { cause: e })
        }
    }

    valueOf() { return this.value }

    #consume(bytes, ...consumeArgs) {
        if (!this.constructor.isMinBytesInput(bytes)) throw new Error(`Insufficient consumable byte length for ${this.constructor.name}: ${bytes.length}`)
        return this.consume(bytes, ...consumeArgs)
    }

}

class intType extends TypeDef {

    static minBytesLength = 4

    static isValueInput(input) { return Number.isInteger(input) }

    static serialize(value) {
        const view = this.getView(4)
        this.unsigned ? view.setUint32(0, value, false) : view.setInt32(0, value, false)
        return new Uint8Array(view.buffer)
    }

    static deserialize(bytes) {
        const view = this.getView(bytes)
        return this.unsigned ? view.getUint32(0, false) : view.getInt32(0, false)
    }

    constructor(input, unsigned) {
        super(input)
        this.unsigned = this.constructor.isValueInput(input) ? input >= 0 : !!unsigned
    }

}

class enumType extends intType {

    #body
    #identifier

    constructor(input, body) {
        super(input, true)
        if (!body || !Array.isArray(body) || !body.length || !body.every(i => typeof i === 'string')) throw new Error('enum must have a body array of string identifiers')
        this.#body = [...body]
        const value = this.value
        if (body[value] === undefined) throw new Error(`no enum identifier found with value ${value}`)
        this.#identifier = body[value]
    }

    get identifier() { return this.#identifier }

    get body() { return this.#body }

}

class boolType extends enumType {

    constructor(input) { super(!!input, [false, true]) }

}

class hyperType extends TypeDef {

    static minBytesLength = 8

    static isValueInput(input) { return typeof input === 'bigint' }

    static serialize(value) {
        const view = this.getView(8)
        view.setBigUint64(0, BigInt.asUintN(64, value), false)
        return new Uint8Array(view.buffer)
    }

    static deserialize(bytes) {
        const view = this.getView(bytes)
        return this.unsigned ? view.getBigUint64(0, false) : view.getBigInt64(0, false)
    }

    constructor(input, unsigned) {
        super(input)
        this.unsigned = this.constructor.isValueInput(input) ? input >= 0n : !!unsigned
    }

    toJSON() { return this.value ? `${this.value}` : null }

}

class floatType extends TypeDef {

    static minBytesLength = 4

    static isValueInput(input) { return typeof input === 'number' }

    static serialize(value) {
        const view = this.getView(4)
        view.setFloat32(0, value, false)
        return new Uint8Array(view.buffer)
    }

    static deserialize(bytes) { return this.getView(bytes).getFloat32(0, false) }

}

class doubleType extends TypeDef {

    static minBytesLength = 8

    static isValueInput(input) { return typeof input === 'number' }

    static serialize(value) {
        const view = this.getView(8)
        view.setFloat64(0, value, false)
        return new Uint8Array(buffer)
    }

    static deserialize(bytes) { return this.getView(bytes).getFloat64(0, false) }

}

class opaqueType extends TypeDef {

    #variableLength
    #length
    #mode

    static isValueInput(input) { return Array.isArray(input) }

    static serialize(value) {
        const mode = this.mode, bytesLength = Math.ceil((mode === 'fixed' ? this.length : this.variableLength) / 4) * 4, bytes = new Uint8Array(bytesLength)
        if (mode === 'variable') {
            const view = this.getView(4)
            view.setUint32(0, this.variableLength, false)
            bytes.set(new Uint8Array(view.buffer))
        }
        bytes.set(value, mode === 'fixed' ? 0 : 4)
        return bytes
    }

    static deserialize(bytes) { return this.mode === 'fixed' ? Array.from(bytes) : Array.from(bytes.subarray(4)) }

    constructor(input, mode, length) {
        if (mode !== 'variable') mode = 'fixed'
        super(input, mode, length)
        this.#length = length
        this.#mode = mode
    }

    consume(bytes, mode, length) {
        let consumeLength
        switch (mode) {
            case 'fixed':
                length ??= 0
                consumeLength = Math.ceil(length / 4) * 4
                if (bytes.length < consumeLength) throw new Error(`Insufficient consumable byte length for fixed length ${this.constructor.name}: ${bytes.length}`)
                return bytes.subarray(0, consumeLength)
            case 'variable':
                const view = this.getView(bytes)
                this.#variableLength = view.getUint32(0, false)
                if (length && (this.#variableLength > length)) throw new Error(`Maximum variable length exceeded for ${this.constructor.name}: ${bytes.length}`)
                consumeLength = Math.ceil(length / 4) * 4
                if (bytes.length < (4 + consumeLength)) throw new Error(`Insufficient consumable byte length for variable length ${this.constructor.name}: ${bytes.length}`)
                return bytes.subarray(0, 4 + consumeLength)
        }
    }

    get length() { return this.#length }

    get mode() { return this.#mode }

    get variableLength() { return this.#variableLength }

}

class stringType extends opaqueType {

    #length
    #variableLength

    static isValueInput(input) { return typeof input === 'string' }

    static serialize(value) {
        const stringBytes = (new TextEncoder()).encode(value),
            bytes = new Uint8Array(4 + (Math.ceil(stringBytes.length / 4) * 4)), view = this.getView(4)
        view.setUint32(0, stringBytes.length, false)
        bytes.set(new Uint8Array(view.buffer))
        bytes.set(stringBytes, 4)
        return bytes
    }

    static deserialize(bytes) { return (new TextDecoder()).decode(bytes.subarray(4)) }

    constructor(input, length) {
        super(input, length)
        this.#length = length
        if (this.isValueInput(input)) this.#variableLength = (new TextEncoder()).encode(value).length
    }

    consume(bytes, length) {
        const view = this.getView(bytes)
        this.#variableLength = view.getUint32(0, false)
        if (length && (this.#variableLength > length)) throw new Error(`Maximum length exceeded for ${this.constructor.name}: ${this.#variableLength}`)
        let consumeLength = Math.ceil(this.#variableLength / 4) * 4
        if (bytes.length < (4 + consumeLength)) throw new Error(`Insufficient consumable byte length for ${this.constructor.name}: ${bytes.length}`)
        return bytes.subarray(0, 4 + consumeLength)
    }

    get length() { return this.#length }

    get variableLength() { return this.#variableLength }

}

class voidType extends TypeDef {

    static isValueInput(input) { return input == null }

    static serialize(value) { return new Uint8Array(0) }

    static deserialize(bytes) { return null }

}

const XDR = {
    typedef: TypeDef,
    int: intType, enum: enumType, bool: boolType, hyper: hyperType, float: floatType, double: doubleType,
    opaque: opaqueType, string: stringType, void: voidType
}

export default XDR

const rx = {
    'const': /const\s+([A-Z_]+)\s*=\s*(0[xX][\dA-Fa-f]+|0[0-7]*|\d+)\s*;/g,
    'enum': /enum\s+(\w+)\s*\{([\s\S]*?)\}\s*;|typedef\s+enum\s*\{([\s\S]*?)\}\s+(\w+);/g,
    struct: /struct\s+(\w+)\s*\{([\s\S]*?)\}\s*;|typedef\s+struct\s*\{([\s\S]*?)\}\s+(\w+)\s*;/g,
    union: /union\s+(\w+)\s+switch\s*\(([\s\S]*?)\)\s*\{([\s\S]*?)\}\s*;|typedef\s+union\s+switch\s*\(([\s\S]*?)\)\s*\{([\s\S]*?)\}\s+(\w+)\s*;/g,
    typedef: /typedef\s+((unsigned)\s+)?(\w+)\s+([\w\[\]\<\>\*]+)\s*;/g,
    unsigned: /^unsigned\s+/, space: /\s+/, comments: /\/\*[\s\S]*?\*\/|\/\/.*$/gm, blankLines: /^\s*[\r\n]/gm
}

const parseTypeLengthModeIdentifier = function (declaration, constants) {
    let unsigned = declaration.slice(0, 9) === 'unsigned ' ? true : undefined,
        [type, identifier] = declaration.replace(rx.unsigned, '').split(rx.space).map(part => part.trim()), length, mode, optional
    if (identifier && identifier[0] === '*') {
        identifier = identifier.slice(1)
        optional = true
    } else if (type && type.endsWith('*')) {
        type = type.slice(0, -1)
        optional = true
    }
    if (type === 'void') return { type, length, mode, identifier, optional }
    const identifierIndexOfLt = identifier.indexOf('<'), identifierIndexOfGt = identifier.indexOf('>'),
        identifierIndexOfBracketStart = identifier.indexOf('['), identifierIndexOfBracketEnd = identifier.indexOf(']')
    if ((identifierIndexOfLt > 0) && (identifierIndexOfLt < identifierIndexOfGt)) {
        length = identifier.slice(identifierIndexOfLt + 1, identifierIndexOfGt)
        length = parseInt(length) || constants[length] || undefined
        mode = 'variable'
        identifier = identifier.slice(0, identifierIndexOfLt)
    } else if ((identifierIndexOfBracketStart > 0) && (identifierIndexOfBracketStart < identifierIndexOfBracketEnd)) {
        length = identifier.slice(identifierIndexOfBracketStart + 1, identifierIndexOfBracketEnd)
        length = parseInt(length) || constants[length] || undefined
        mode = 'fixed'
        identifier = identifier.slice(0, identifierIndexOfBracketStart)
    }
    return { type, length, mode, identifier, optional, unsigned }
}

export function X(xCode) {
    if (!xCode || (typeof xCode !== 'string')) return
    xCode = xCode.replace(rx.comments, '').replace(rx.blankLines, '').trim()
    const lines = [], constants = {}, enums = {}, structs = {}, unions = {}, typedefs = {}

    for (const m of xCode.matchAll(rx.const)) {
        constants[m[1]] = parseInt(m[2], m[2][0] === '0' && m[2][1] !== '.' && m[2][1] !== 'x' ? 8 : undefined)
        xCode = xCode.replace(m[0], '').replace(rx.blankLines, '').trim()
    }

    for (const t of xCode.matchAll(rx.typedef)) {
        const typeObj = parseTypeLengthModeIdentifier(t[2] ? `${t[2]} ${t[3]} ${t[4]}` : `${t[3]} ${t[4]}`, constants)
        typedefs[typeObj.identifier] = typeObj
        xCode = xCode.replace(t[0], '').replace(rx.blankLines, '').trim()
    }

    for (const m of xCode.matchAll(rx.enum)) {
        const isTypeDef = m[0].slice(0, 8) === 'typedef ', enumName = isTypeDef ? m[4] : m[1],
            enumBody = isTypeDef ? m[3] : m[2], body = []
        for (const condition of enumBody.split(',')) {
            let [name, value] = condition.split('=').map(part => part.trim())
            if (!name || !value) throw new Error(`enum ${enumName} has invalid condition: ${condition}`)
            value = parseInt(value, value[0] === '0' && value[1] !== '.' && value[1] !== 'x' ? 8 : undefined)
            if (!Number.isInteger(value)) throw new Error(`enum ${enumName} has invalid condition: ${condition}`)
            body[value] = name
        }
        enums[enumName] = body
        xCode = xCode.replace(m[0], '').replace(rx.blankLines, '').trim()
    }

    const buildStructFromMatch = function (m) {
        const isTypeDef = m[0].slice(0, 8) === 'typedef '
        const structName = isTypeDef ? m[4] : m[1], map = new Map()
        const structBody = isTypeDef ? m[3] : m[2]
        for (let declaration of structBody.split('\n')) {
            declaration = declaration.trim()
            if (declaration[declaration.length - 1] === ';') declaration = declaration.slice(0, -1).trim()
            if (!declaration) continue
            if (declaration[0] === ';') continue
            const { type, length, mode, identifier, optional, unsigned } = parseTypeLengthModeIdentifier(declaration, constants)
            if (!type || !identifier) throw new Error(`struct ${structName} has invalid declaration: ${declaration};`)
            map.set(identifier, { type, length, mode, optional, unsigned })
        }
        return [structName, map]
    }

    const buildUnionFromMatch = function (m) {
        const isTypeDef = m[0].slice(0, 8) === 'typedef ', unionName = isTypeDef ? m[6] : m[1], discriminantDeclaration = isTypeDef ? m[4] : m[2], arms = {}
        const [discriminantType, discriminantValue] = discriminantDeclaration.trim().split(rx.space).map(part => part.trim())
        const discriminant = { type: discriminantType, value: discriminantValue }
        const unionBody = isTypeDef ? m[5] : m[3]
        const queuedArms = []
        for (let caseSpec of unionBody.split('case ')) {
            caseSpec = caseSpec.trim()
            if (!caseSpec) continue
            let [discriminantValue, armDeclaration] = caseSpec.split(':').map(part => part.trim())
            if (!armDeclaration) {
                queuedArms.push(discriminantValue)
                continue
            }
            if (armDeclaration[armDeclaration.length - 1] === ';') armDeclaration = armDeclaration.slice(0, -1).trim()
            switch (armDeclaration.split(rx.space)[0]) {
                case 'struct':
                    for (const mm of `typedef ${armDeclaration};`.matchAll(rx.struct)) {
                        const [structName, map] = buildStructFromMatch(mm)
                        structs[structName] = map
                        arms[discriminantValue] = { type: structName }
                    }
                    break
                case 'union':
                    for (const mm of `typedef ${armDeclaration};`.matchAll(rx.union)) {
                        const [unionName, map] = buildUnionFromMatch(mm)
                        unions[unionName] = map
                        arms[discriminantValue] = { type: unionName }
                    }
                    break
                default:
                    arms[discriminantValue] = parseTypeLengthModeIdentifier(armDeclaration, constants)
            }
            if (queuedArms.length) {
                for (const d of queuedArms) arms[d] = { ...arms[discriminantValue] }
                queuedArms.length = 0
            }
        }
        return [unionName, discriminant, arms]
    }

    for (const m of xCode.matchAll(rx.union)) {
        const [unionName, discriminant, arms] = buildUnionFromMatch(m)
        unions[unionName] = { discriminant, arms }
        xCode = xCode.replace(m[0], '').replace(rx.blankLines, '').trim()
    }

    for (const m of xCode.matchAll(rx.struct)) {
        const [structName, map] = buildStructFromMatch(m)
        structs[structName] = map
        xCode = xCode.replace(m[0], '').replace(rx.blankLines, '').trim()
    }

    let entry
    const dependedTypes = new Set()
    for (const name in unions) for (const a in unions[name].arms) dependedTypes.add(unions[name].arms[a].type)
    for (const name in structs) for (const p in structs[name]) dependedTypes.add(structs[name][p].type)
    for (const name of Object.keys(structs).concat(Object.keys(unions))) {
        if (!dependedTypes.has(name)) entry = name
        if (entry) break
    }
    if (!entry) throw new Error('no entry found')

    console.log('line 421', JSON.stringify({
        entry, constants, enums, typedefs, unions,
        structs: Object.fromEntries(Object.entries(structs).map(ent => [ent[0], Object.fromEntries(ent[1].entries())]))
    }, null, 4))

    const typeClass = class extends TypeDef {

        static serialize(value) {
            const bytes = new Uint8Array()

            return bytes
        }

        static deserialize(bytes) {
            const value = {}

            return value
        }

        consume(bytes) {
            return bytes.subarray(0, this.constructor.minBytesLength)
        }

    }

    return typeClass

}
