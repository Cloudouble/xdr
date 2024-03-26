class TypeDef {

    #bytes
    #value

    static minBytesLength = 0

    static additionalArgs = []

    static serialize(value) { return new Uint8Array() }

    static deserialize(bytes) { return }

    static getView(i, byteOffset, byteLength) {
        if (typeof i === 'number') return new DataView(new ArrayBuffer(i))
        if (i instanceof Uint8Array) return new DataView(i.buffer, i.byteOffset + (byteOffset ?? 0), byteLength ?? i.byteLength)
    }

    static isValueInput(input) { return input && !(input instanceof Uint8Array) && (input instanceof Object) }

    static isMinBytesInput(bytes) { return Number.isInteger(this.minBytesLength) ? (bytes.length >= this.minBytesLength) : true }

    constructor(input, ...consumeArgs) {
        if (!(input instanceof Uint8Array) && Array.isArray(input) && input.every(i => Number.isInteger(i) && (i >= 0) && (i <= 255))) input = new Uint8Array(input)
        if (input instanceof Uint8Array) {
            const consumeResult = this.#consume(input, ...consumeArgs), isConsumeResultArray = Array.isArray(consumeResult)
            this.#bytes = isConsumeResultArray ? consumeResult[0] : consumeResult
            if (isConsumeResultArray && consumeResult.length > 1) this.#value = consumeResult[1]
        } else if (this.constructor.isValueInput(input)) {
            this.#value = input
        } else {
            throw new Error(`Invalid input for ${this.constructor.name}: ${input}`)
        }
    }

    consume(bytes) { return bytes.subarray(0, this.constructor.minBytesLength) }

    get bytes() { return this.#bytes ??= this.constructor.serialize(this.#value, this) }

    get value() { return this.#value ??= this.constructor.deserialize(this.#bytes, this) }

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

    static additionalArgs = ['unsigned']

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

function enumFactory(body) {
    if (!body || !Array.isArray(body) || !body.length || !(body.every(i => typeof i === 'string') || body.every(i => typeof i === 'boolean'))) throw new Error('enum must have a body array of string or boolean identifiers')
    return class extends intType {

        #body = body
        #identifier

        constructor(input) {
            const originalInput = input
            switch (typeof input) {
                case 'boolean': case 'string':
                    input = body.indexOf(input)
            }
            super(input, true)
            const value = this.value
            if (this.#body[value] === undefined) throw new Error(`no enum identifier found for ${typeof originalInput} ${originalInput}`)
            this.#identifier = this.#body[value]
        }

        get identifier() { return this.#identifier }

        get body() { return this.#body }

    }
}

const boolType = enumFactory([false, true])

class hyperType extends TypeDef {

    static minBytesLength = 8

    static additionalArgs = ['unsigned']

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
        return new Uint8Array(view.buffer)
    }

    static deserialize(bytes) { return this.getView(bytes).getFloat64(0, false) }

}

class opaqueType extends TypeDef {

    static additionalArgs = ['mode', 'length']

    static isValueInput(input) { return Array.isArray(input) }

    static serialize(value, instance, mode, length) {
        mode ??= instance.mode
        length ??= instance.length
        const bytesLength = Math.ceil((mode === 'fixed' ? length : (4 + value.length)) / 4) * 4, bytes = new Uint8Array(bytesLength)
        if (mode === 'variable') {
            const view = this.getView(4)
            view.setUint32(0, value.length, false)
            bytes.set(new Uint8Array(view.buffer))
        }
        bytes.set(value, mode === 'fixed' ? 0 : 4)
        return bytes
    }

    static deserialize(bytes, instance) { return instance.mode === 'fixed' ? Array.from(bytes) : Array.from(bytes.subarray(4)) }

    constructor(input, mode, length) {
        if (mode !== 'variable') mode = 'fixed'
        length ??= input.length
        super(input, mode, length, Array.isArray(input))
        Object.defineProperties(this, {
            length: { value: length, enumerable: true },
            mode: { value: mode, enumerable: true }
        })
    }

    consume(bytes, mode, length, isValueInput) {
        if (isValueInput) return [this.constructor.serialize(bytes, this, mode, length), Array.from(bytes)]
        let consumeLength = Math.ceil(length / 4) * 4, cursor = mode === 'variable' ? (4 + consumeLength) : consumeLength
        if (bytes.length > cursor) throw new Error(`Insufficient consumable byte length for ${mode} length ${this.constructor.name}: ${bytes.length}`)
        if (mode === 'variable') {
            const valueLength = this.constructor.getView(bytes, 0, 4).getUint32(0, false)
            if (length && (valueLength > length)) throw new Error(`Maximum variable value length exceeded for ${this.constructor.name}: ${bytes.length}`)
        }
        return bytes.subarray(0, cursor)
    }

}

class stringType extends TypeDef {

    #maxLength

    static additionalArgs = ['length']

    static isValueInput(input) { return typeof input === 'string' }

    static serialize(value) {
        const stringBytes = (new TextEncoder()).encode(value), view = this.getView(4),
            bytes = new Uint8Array(4 + (Math.ceil(stringBytes.length / 4) * 4))
        view.setUint32(0, stringBytes.length, false)
        bytes.set(new Uint8Array(view.buffer))
        bytes.set(stringBytes, 4)
        return bytes
    }

    static deserialize(bytes) { return (new TextDecoder()).decode(bytes.subarray(4)) }

    constructor(input, maxLength) {
        super(input, length)
        this.#maxLength = maxLength
    }

    consume(bytes, maxLength) {
        const stringLength = this.constructor.getView(bytes).getUint32(0, false)
        if (maxLength && (stringLength > maxLength)) throw new Error(`Maximum length exceeded for ${this.constructor.name}: ${stringLength}`)
        let consumeLength = Math.ceil(stringLength / 4) * 4
        if (bytes.length < (4 + consumeLength)) throw new Error(`Insufficient consumable byte length for ${this.constructor.name}: ${bytes.length}`)
        return bytes.subarray(0, 4 + consumeLength)
    }

    get maxLength() { return this.#maxLength }

}

class voidType extends TypeDef {

    static isValueInput(input) { return input == null }

    static serialize() { return new Uint8Array(0) }

    static deserialize() { return null }

}

const xdrTypes = {
    int: intType, bool: boolType, hyper: hyperType, float: floatType, double: doubleType,
    opaque: opaqueType, string: stringType, void: voidType
}

const XDR = { enumFactory, typedef: TypeDef, ...xdrTypes }

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
        const lengthName = identifier.slice(identifierIndexOfLt + 1, identifierIndexOfGt)
        length = parseInt(lengthName) || constants[lengthName] || undefined
        identifier = identifier.slice(0, identifierIndexOfLt)
        mode = 'variable'
    } else if ((identifierIndexOfBracketStart > 0) && (identifierIndexOfBracketStart < identifierIndexOfBracketEnd)) {
        const lengthName = identifier.slice(identifierIndexOfBracketStart + 1, identifierIndexOfBracketEnd)
        length = parseInt(lengthName) || constants[lengthName] || undefined
        identifier = identifier.slice(0, identifierIndexOfBracketStart)
        mode = 'fixed'
    }
    return { type, length, mode, identifier, optional, unsigned }
}

export function X(xCode) {
    if (!xCode || (typeof xCode !== 'string')) return
    xCode = xCode.replace(rx.comments, '').replace(rx.blankLines, '').trim()
    const constants = {}, enums = {}, structs = {}, unions = {}, typedefs = {}

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
            let [name, value] = condition.split('=').map(s => s.trim())
            if (!name || !value) throw new Error(`enum ${enumName} has invalid condition: ${condition}`)
            value = parseInt(value, value[0] === '0' && value[1] !== '.' && value[1] !== 'x' ? 8 : undefined)
            if (!Number.isInteger(value)) throw new Error(`enum ${enumName} has invalid condition: ${condition}`)
            body[value] = name
        }
        enums[enumName] = body
        xCode = xCode.replace(m[0], '').replace(rx.blankLines, '').trim()
    }

    const buildStructFromMatch = function (m) {
        const isTypeDef = m[0].slice(0, 8) === 'typedef ', structName = isTypeDef ? m[4] : m[1], map = new Map(), structBody = isTypeDef ? m[3] : m[2]
        for (let declaration of structBody.split('\n')) {
            declaration = declaration.trim()
            if (declaration[declaration.length - 1] === ';') declaration = declaration.slice(0, -1).trim()
            if ((!declaration) || (declaration[0] === ';')) continue
            const { type, length, mode, identifier, optional, unsigned } = parseTypeLengthModeIdentifier(declaration, constants)
            if (!type || !identifier) throw new Error(`struct ${structName} has invalid declaration: ${declaration};`)
            map.set(identifier, { type, length, mode, optional, unsigned })
        }
        return [structName, map]
    }

    const buildUnionFromMatch = function (m) {
        const isTypeDef = m[0].slice(0, 8) === 'typedef ', unionName = isTypeDef ? m[6] : m[1], discriminantDeclaration = isTypeDef ? m[4] : m[2],
            [discriminantType, discriminantValue] = discriminantDeclaration.trim().split(rx.space).map(part => part.trim()), arms = {},
            discriminant = { type: discriminantType, value: discriminantValue }, unionBody = isTypeDef ? m[5] : m[3], queuedArms = []
        for (let caseSpec of unionBody.split('case ')) {
            caseSpec = caseSpec.trim()
            if (!caseSpec) continue
            let [discriminantValue, armDeclaration] = caseSpec.split(':').map(s => s.trim())
            if (!armDeclaration) { queuedArms.push(discriminantValue); continue }
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

    const manifest = { entry, constants, enums, typedefs, unions, structs }

    console.log('line 413', JSON.stringify(Object.assign({ ...manifest }, { structs: Object.fromEntries(Object.entries(structs).map(ent => [ent[0], Object.fromEntries(ent[1].entries())])) }), null, 4))

    const typeClass = class extends TypeDef {

        static manifest = manifest

        static serialize(value, declaration) {
            let type = declaration?.type ?? this.manifest.entry
            declaration ??= this.manifest.structs[type]
            let result
            if (type in xdrTypes) {
                result = (new xdrTypes[type](value, ...xdrTypes[type].additionalArgs.map(a => declaration[a]))).bytes
            } else if (type in this.manifest.structs) {
                const chunks = []
                let totalLength = 0
                for (const [identifier, identifierDeclaration] of declaration.entries()) {
                    const chunk = this.serialize(value[identifier], identifierDeclaration)
                    chunks.push([chunk, totalLength])
                    totalLength += chunk.length
                }
                result = new Uint8Array(totalLength)
                for (const chunk of chunks) result.set(...chunk)
            } else if (type in this.manifest.unions) {
                const unionManifest = this.manifest.unions[type], enumIdentifier = value[unionManifest.discriminant.value],
                    enumClass = enumFactory(this.manifest.enums[unionManifest.discriminant.type]), discriminantBytes = (new enumClass(enumIdentifier)).bytes,
                    armManifest = unionManifest.arms[enumIdentifier], armBytes = this.serialize(value[armManifest.identifier], unionManifest.arms[enumIdentifier])
                result = new Uint8Array(discriminantBytes.length + armBytes.length)
                result.set(discriminantBytes, 0)
                result.set(armBytes, discriminantBytes.length)
            }
            return result
        }

        static deserialize(bytes, declaration, raw) {
            const type = declaration?.type ?? this.manifest.entry
            declaration ??= this.manifest.structs[type]
            let result
            if (type in xdrTypes) {
                result = (new xdrTypes[type](bytes, ...xdrTypes[type].additionalArgs.map(a => declaration[a])))
            } else if (type in this.manifest.structs) {
                const value = {}
                let byteLength = 0, entryResult
                for (const [identifier, identifierDeclaration] of declaration.entries()) {
                    entryResult = this.deserialize(bytes, identifierDeclaration, true)
                    byteLength += entryResult.bytes.byteLength
                    value[identifier] = entryResult.value
                    bytes = bytes.subarray(entryResult.bytes.byteLength)
                }
                result = { value, bytes: { byteLength } }
            } else if (type in this.manifest.unions) {
                let byteLength = 0, newBytes = bytes.slice()
                const unionManifest = this.manifest.unions[type],
                    enumClass = enumFactory(this.manifest.enums[unionManifest.discriminant.type]), discriminantInstance = new enumClass(newBytes),
                    value = { [unionManifest.discriminant.value]: discriminantInstance.identifier }
                newBytes = newBytes.subarray(discriminantInstance.bytes.byteLength)
                byteLength += discriminantInstance.bytes.byteLength
                const armManifest = unionManifest.arms[discriminantInstance.identifier],
                    armValue = this.deserialize(newBytes, unionManifest.arms[discriminantInstance.identifier], true)
                value[armManifest.identifier] = armValue.value
                byteLength += armValue.bytes.byteLength
                result = { value, bytes: { byteLength } }
            }
            return raw ? result : result.value
        }

        consume(bytes) {
            return bytes.subarray(0, this.constructor.minBytesLength)
        }

    }

    return typeClass

}
