class TypeDef {

    #bytes
    #value

    static namespace
    static additionalArgs = []
    static minBytesLength = 0

    static deserialize(bytes) { return }
    static getView(i, byteOffset, byteLength) {
        if (typeof i === 'number') return new DataView(new ArrayBuffer(i))
        if (i instanceof Uint8Array) return new DataView(i.buffer, i.byteOffset + (byteOffset ?? 0), byteLength ?? i.byteLength)
    }
    static isMinBytesInput(bytes) { return Number.isInteger(this.minBytesLength) ? (bytes.length >= this.minBytesLength) : true }
    static isValueInput(input) { return !(input instanceof Uint8Array) }
    static serialize(value) { return new Uint8Array() }

    constructor(input, ...consumeArgs) {
        if (input instanceof Uint8Array) {
            const consumeResult = this.#consume(input, ...consumeArgs), isConsumeResultArray = Array.isArray(consumeResult)
            this.#bytes = isConsumeResultArray ? consumeResult[0] : consumeResult
            if (isConsumeResultArray && consumeResult.length > 1) this.#value = consumeResult[1]
        } else if (this.constructor.isValueInput(input)) {
            this.#value = input
        } else {
            throw new Error(`Invalid input for ${this.constructor.name}: ${input}`)
        }
        Object.defineProperties(this, {
            bytes: { get: function () { return this.#bytes ??= this.constructor.serialize(this.#value, this) }, enumerable: true },
            value: { get: function () { return this.#value ??= this.constructor.deserialize(this.#bytes, this) }, enumerable: true }
        })
    }

    consume(bytes) { return bytes.subarray(0, this.constructor.minBytesLength) }

    toJSON() { return this.value == undefined ? null : this.value }
    toString() {
        try {
            return JSON.stringify(this.value ?? null)
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

    static additionalArgs = ['unsigned']
    static minBytesLength = 4

    static deserialize(bytes) { return this.getView(bytes)[this.unsigned ? 'getUint32' : 'getInt32'](0, false) }
    static isValueInput(input) { return Number.isInteger(input) }
    static serialize(value) {
        const view = this.getView(4)
        view[this.unsigned ? 'setUint32' : 'setInt32'](0, value, false)
        return new Uint8Array(view.buffer)
    }

    constructor(input, unsigned) {
        super(input)
        this.unsigned = this.constructor.isValueInput(input) ? input >= 0 : !!unsigned
    }

}

class hyperType extends intType {

    static minBytesLength = 8

    static deserialize(bytes) { return this.getView(bytes)[this.unsigned ? 'getBigUint64' : 'getBigInt64'](0, false) }
    static isValueInput(input) { return typeof input === 'bigint' }
    static serialize(value) {
        const view = this.getView(8)
        view.setBigUint64(0, BigInt.asUintN(64, value), false)
        return new Uint8Array(view.buffer)
    }

    toJSON() { return this.value == undefined ? null : `${this.value}n` }

}

class floatType extends TypeDef {

    static minBytesLength = 4

    static deserialize(bytes) { return this.getView(bytes).getFloat32(0, false) }
    static isValueInput(input) { return typeof input === 'number' }
    static serialize(value) {
        const view = this.getView(4)
        view.setFloat32(0, value, false)
        return new Uint8Array(view.buffer)
    }

}

class doubleType extends floatType {

    static minBytesLength = 8

    static deserialize(bytes) { return this.getView(bytes).getFloat64(0, false) }
    static serialize(value) {
        const view = this.getView(8)
        view.setFloat64(0, value, false)
        return new Uint8Array(view.buffer)
    }

}

class opaqueType extends TypeDef {

    static additionalArgs = ['length', 'mode']

    static deserialize(bytes, instance) {
        switch (instance.mode) {
            case 'fixed':
                return Array.from(bytes)
            case 'variable':
                const maxOffset = this.getView(bytes).getUint32(0, false) + 4, data = []
                for (let offset = 4; offset < maxOffset; offset++) data.push(bytes[offset])
                return data
        }
    }
    static isValueInput(input) { return Array.isArray(input) }
    static serialize(value, instance, length, mode) {
        mode ??= instance.mode
        length ??= instance.length
        const bytes = new Uint8Array(Math.ceil((mode === 'fixed' ? length : (4 + value.length)) / 4) * 4)
        if (mode === 'variable') {
            const view = this.getView(4)
            view.setUint32(0, value.length, false)
            bytes.set(new Uint8Array(view.buffer))
        }
        bytes.set(value, mode === 'fixed' ? 0 : 4)
        return bytes
    }

    constructor(input, length, mode) {
        length ??= input.length
        if (mode !== 'variable') mode = 'fixed'
        const inputIsArray = Array.isArray(input)
        super(input, length, mode, inputIsArray)
        if (mode === 'fixed' && inputIsArray && input.length !== length) throw new Error(`Fixed value length mismatch for ${this.constructor.name}: ${input.length}!= ${length}`)
        Object.defineProperties(this, {
            length: { value: length, enumerable: true },
            mode: { value: mode, enumerable: true }
        })
    }

    consume(bytes, length, mode, isValueInput) {
        if (isValueInput) return [this.constructor.serialize(bytes, this, mode, length), Array.from(bytes)]
        let consumeLength = Math.ceil(length / 4) * 4
        if (mode === 'variable') {
            const valueLength = this.constructor.getView(bytes, 0, 4).getUint32(0, false)
            if (length && (valueLength > length)) throw new Error(`Maximum variable value length exceeded for ${this.constructor.name}: ${valueLength} > ${bytes.length}`)
            consumeLength = 4 + Math.ceil(valueLength / 4) * 4
        }
        if (consumeLength > bytes.length) throw new Error(`Insufficient consumable byte length for ${mode} length ${this.constructor.name}: have ${bytes.length}, need ${consumeLength} bytes.`)
        return bytes.subarray(0, consumeLength)
    }

}

class stringType extends TypeDef {

    #maxLength

    static additionalArgs = ['length']

    static deserialize(bytes) {
        const maxOffset = this.getView(bytes).getUint32(0, false) + 4, chars = [], decoder = new TextDecoder()
        for (let offset = 4; offset < maxOffset; offset++) chars.push(decoder.decode(bytes.subarray(offset, offset + 1)))
        return chars.join('')
    }
    static isValueInput(input) { return typeof input === 'string' }
    static serialize(value) {
        const stringBytes = (new TextEncoder()).encode(value), view = this.getView(4),
            bytes = new Uint8Array(4 + (Math.ceil(stringBytes.length / 4) * 4))
        view.setUint32(0, stringBytes.length, false)
        bytes.set(new Uint8Array(view.buffer))
        bytes.set(stringBytes, 4)
        return bytes
    }

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

    toString() { return this.value ?? '' }

}

class voidType extends TypeDef {

    static deserialize() { return null }
    static isValueInput(input) { return input == null }

}

const rx = {
    'const': /const\s+([A-Z_]+)\s*=\s*(0[xX][\dA-Fa-f]+|0[0-7]*|\d+)\s*;/g, 'enum': /enum\s+(\w+)\s*\{([\s\S]*?)\}\s*;|typedef\s+enum\s*\{([\s\S]*?)\}\s+(\w+);/g,
    struct: /struct\s+(?<name>\w+)\s*\{(?<body>[^\{\}]*?)\}\s*;|typedef\s+struct\s*\{(?<bodyTypeDef>[^\{\}]*?)\}\s+(?<nameTypeDef>\w+)\s*;/g,
    union: /union\s+(?<name>\w+)\s+switch\s*\((?<discriminant>[^\)]+?)\)\s*\{(?<body>[^\{\}]*?)\}\s*;|typedef\s+union\s+switch\s*\((?<discriminantTypeDef>[^\)]+?)\)\s*\{(?<bodyTypeDef>[^\{\}]*?)\}\s+(?<nameTypeDef>\w+)\s*;/g,
    structAnonymousFlat: /struct\s*\{(?<body>[^\{\}]*?)\}\s+(?<name>\w+)\s*;/g,
    unionAnonymousFlat: /union\s+switch\s*\((?<discriminant>[^\)]+?)\)\s*\{(?<body>[^\{\}]*?)\}\s+(?<name>\w+)\s*;/g,
    typedef: /typedef\s+((unsigned)\s+)?(\w+)\s+([\w\[\]\<\>\*]+)\s*;/g, namespace: /^\s*namespace\s+([\w]+)\s*\{/m,
    includes: /\%\#include\s+\".+\"/g, unsigned: /^unsigned\s+/, space: /\s+/, comments: /\/\*[\s\S]*?\*\/|\/\/.*$/gm, blankLines: /^\s*[\r\n]/gm
}

const parseTypeLengthModeIdentifier = function (declaration, constants) {
    let unsigned = declaration.slice(0, 9) === 'unsigned ' ? true : undefined,
        [type, identifier] = declaration.replace(rx.unsigned, '').split(rx.space).map(part => part.trim()), length, mode,
        identifierHasStar = identifier && (identifier[0] === '*'), typeHasStar = type && type.endsWith('*'),
        optional = identifierHasStar || typeHasStar
    if (identifierHasStar) identifier = identifier.slice(1)
    if (typeHasStar) type = type.slice(0, -1)
    if (type === 'void') return { type, length, mode, identifier, optional }
    const identifierIndexOfLt = identifier.indexOf('<'), identifierIndexOfGt = identifier.indexOf('>'),
        identifierIndexOfBracketStart = identifier.indexOf('['), identifierIndexOfBracketEnd = identifier.indexOf(']')
    if ((identifierIndexOfLt > 0) && (identifierIndexOfLt < identifierIndexOfGt)) {
        const lengthName = identifier.slice(identifierIndexOfLt + 1, identifierIndexOfGt)
        length = parseInt(lengthName) || constants[lengthName]
        identifier = identifier.slice(0, identifierIndexOfLt)
        mode = 'variable'
    } else if ((identifierIndexOfBracketStart > 0) && (identifierIndexOfBracketStart < identifierIndexOfBracketEnd)) {
        const lengthName = identifier.slice(identifierIndexOfBracketStart + 1, identifierIndexOfBracketEnd)
        length = parseInt(lengthName) || constants[lengthName]
        identifier = identifier.slice(0, identifierIndexOfBracketStart)
        mode = 'fixed'
    }
    return { type, length, mode, identifier, optional, unsigned }
}

function createEnum(body, name) {
    body ||= 0
    if (body && (!Array.isArray(body) || !body.length || !(body.every(i => typeof i === 'string') || body.every(i => typeof i === 'boolean')))) throw new Error('enum must have a body array of string or boolean identifiers')
    return class extends intType {

        static name = name

        #body
        #identifier

        constructor(input) {
            let originalInput = input
            switch (typeof input) {
                case 'boolean': case 'string':
                    input = body.indexOf(input)
                default:
                    if (!body) input = parseInt(input) || 0
            }
            super(input, true)
            this.#body = body
            this.#identifier = this.#body ? this.#body[this.value] : input
            if (this.#body && (this.#identifier === undefined)) throw new Error(`no enum identifier found for ${typeof originalInput} ${originalInput}`)
        }

        get identifier() { return this.#identifier }

        get body() { return this.#body }

    }
}

const boolType = createEnum([false, true], 'boolType')
Object.defineProperties(boolType.prototype, {
    toJSON: { value: function () { return !!this.value } },
    toString: { value: function () { return this.value ? 'true' : 'false' } }
})

const manifestToJson = manifest => {
    const retval = {}
    for (const manifestKey in manifest) {
        switch (typeof manifest[manifestKey]) {
            case 'undefined': case 'function': continue
            case 'object':
                if (manifestKey === 'structs') {
                    retval.structs = {}
                    for (const structName in manifest.structs) retval.structs[structName] = JSON.parse(JSON.stringify(Array.from(manifest.structs[structName].entries())))
                    continue
                }
                retval[manifestKey] = JSON.parse(JSON.stringify(manifest[manifestKey]))
            default:
                retval[manifestKey] = manifest[manifestKey]
        }
    }
    return retval
}

const BaseClass = class extends TypeDef {

    static entry
    static manifest = {}
    static name
    static namespace

    static serialize(value, instance, declaration) {
        let type = declaration?.type ?? this.manifest.entry, result
        declaration ??= this.manifest.structs[type] ?? this.manifest.unions[type] ?? this.manifest.typedefs[type]
        const runSerialize = (v, cb) => {
            let r
            if (declaration.mode && declaration.length && Array.isArray(v)) {
                let totalLength = 0
                const chunks = [[new intType(v.length).bytes, totalLength]]
                totalLength += 4
                for (const item of v) totalLength += chunks[chunks.push([cb(item), totalLength]) - 1][0].length
                r = new Uint8Array(totalLength)
                for (const chunk of chunks) r.set(...chunk)
                return r
            }
            return cb(v)
        }
        if (type in XDR.types) {
            result = (new XDR.types[type](value, ...XDR.types[type].additionalArgs.map(a => declaration[a]))).bytes
        } else if (type in this.manifest.typedefs) {
            switch (this.manifest.typedefs[type].type) {
                case 'opaque':
                    result = this.serialize(value, undefined, { ...this.manifest.typedefs[type] })
                    break
                default:
                    result = runSerialize(value, itemValue => this.serialize(itemValue, undefined, { ...this.manifest.typedefs[type], mode: undefined, length: undefined }))
            }
        } else if (type in this.manifest.structs) {
            const serializeStructItem = itemValue => {
                const itemChunks = []
                let itemTotalLength = 0
                for (let [identifier, identifierDeclaration] of this.manifest.structs[type].entries()) {
                    if (identifierDeclaration.optional) {
                        const hasField = itemValue[identifier] !== undefined, hasFieldBool = new boolType(hasField)
                        itemChunks.push([hasFieldBool.bytes, itemTotalLength])
                        itemTotalLength += 4
                        if (!hasField) continue
                        identifierDeclaration = { ...identifierDeclaration, optional: undefined }
                    }
                    itemTotalLength += itemChunks[itemChunks.push([this.serialize(itemValue[identifier], undefined, identifierDeclaration), itemTotalLength]) - 1][0].length
                }
                const itemResult = new Uint8Array(itemTotalLength)
                for (const chunk of itemChunks) itemResult.set(...chunk)
                return itemResult
            }
            result = runSerialize(value, serializeStructItem)
        } else if (type in this.manifest.unions) {
            const unionManifest = this.manifest.unions[type], enumClass = createEnum(this.manifest.enums[unionManifest.discriminant.type], unionManifest.discriminant.type)
            const serializeUnionItem = itemValue => {
                const enumIdentifier = itemValue[unionManifest.discriminant.value], discriminantBytes = (new enumClass(enumIdentifier)).bytes,
                    armManifest = unionManifest.arms[enumIdentifier], armBytes = this.serialize(itemValue[armManifest.identifier], undefined, unionManifest.arms[enumIdentifier]),
                    itemResult = new Uint8Array(discriminantBytes.length + armBytes.length)
                itemResult.set(discriminantBytes, 0)
                itemResult.set(armBytes, discriminantBytes.length)
                return itemResult
            }
            result = runSerialize(value, serializeUnionItem)
        }
        return result
    }

    static deserialize(bytes, instance, declaration, raw, isArrayItem) {
        const type = declaration?.type ?? this.manifest.entry
        const runDeserialize = (b, bl, d, iai) => {
            const r = this.deserialize(b, undefined, d, true, iai)
            return [bl + r.bytes.byteLength, r.value, b.subarray(r.bytes.byteLength)]
        }
        declaration ??= this.manifest.structs[type] ?? this.manifest.unions[type] ?? this.manifest.typedefs[type]
        let result
        if (type in XDR.types) {
            result = (new XDR.types[type](bytes, ...XDR.types[type].additionalArgs.map(a => declaration[a])))
        } else if (type in this.manifest.typedefs) {
            result = this.deserialize(bytes, undefined, { ...this.manifest.typedefs[type], identifier: declaration.identifier }, true)
        } else if (type in this.manifest.structs) {
            const value = {}
            let byteLength = 0, entryResult
            for (let [identifier, identifierDeclaration] of this.manifest.structs[type].entries()) {
                const { length: declarationLength, mode: declarationMode, type: declarationType, optional: declarationOptional } = identifierDeclaration
                if (declarationOptional) {
                    const hasField = !!this.getView(bytes).getUint32(0, false)
                    bytes = bytes.subarray(4)
                    byteLength += 4
                    if (!hasField) continue
                }
                if (declarationLength && (!XDR.types[declarationType] || (XDR.types[declarationType] && !(XDR.types[declarationType].prototype instanceof TypeDef)))) {
                    const declarationVariableLength = declarationMode === 'variable' ? this.getView(bytes).getUint32(0, false) : declarationLength
                    if (declarationMode === 'variable') {
                        if (declarationVariableLength > declarationLength) throw new Error('variable length exceeds declaration length')
                        bytes = bytes.subarray(4)
                        byteLength += 4
                    }
                    entryResult = new Array(declarationVariableLength)
                    for (const i of entryResult.keys()) [byteLength, entryResult[i], bytes] = runDeserialize(bytes, byteLength, { ...identifierDeclaration, length: undefined, mode: undefined }, true)
                    if (identifier) value[identifier] = entryResult
                } else {
                    [byteLength, value[identifier], bytes] = runDeserialize(bytes, byteLength, identifierDeclaration, true)
                }
            }
            result = { value, bytes: { byteLength } }
        } else if (type in this.manifest.unions) {
            let byteLength = 0, discriminantInstance
            const unionManifest = this.manifest.unions[type], enumClass = createEnum(this.manifest.enums[unionManifest.discriminant.type],
                unionManifest.discriminant.type), enumValue = this.getView(bytes).getUint32(0, false)
            bytes = bytes.subarray(4)
            byteLength += 4
            try {
                discriminantInstance = new enumClass(enumValue)
            } catch (e) {
                discriminantInstance = new enumClass(0)
            }
            let armDeclaration = unionManifest.arms[discriminantInstance.identifier], armResult
            if (armDeclaration === undefined) {
                discriminantInstance = new enumClass(0)
                armDeclaration = unionManifest.arms[discriminantInstance.identifier]
            }
            const value = { [unionManifest.discriminant.value]: discriminantInstance.identifier }
            if (isArrayItem) {
                armDeclaration = { ...armDeclaration }
                delete armDeclaration.length
                delete armDeclaration.mode
            }
            const { length: armLength, mode: armMode, type: armType, identifier } = armDeclaration
            if (armLength && !(armType in XDR.types)) {
                const armVariableLength = armMode === 'variable' ? this.getView(bytes).getUint32(0, false) : armLength
                if (armMode === 'variable') {
                    bytes = bytes.subarray(4)
                    byteLength += 4
                    if (armVariableLength > armLength) throw new Error('variable length exceeds arm declaration length')
                }
                armResult = new Array(armVariableLength)
                for (const i of armResult.keys()) [byteLength, armResult[i], bytes] = runDeserialize(bytes, byteLength, { ...armDeclaration, length: undefined, mode: undefined }, true)
                if (identifier) value[identifier] = armResult
            } else {
                let r
                [byteLength, r, bytes] = runDeserialize(bytes, byteLength, armDeclaration, true)
                if (identifier) value[identifier] = r
            }
            result = { value, bytes: { byteLength } }
        }
        return raw ? result : result.value
    }

    consume(bytes) {
        const newBytes = bytes.slice(0), testValue = this.constructor.deserialize(newBytes, undefined, undefined, true)
        if (this.value === undefined) this.value = testValue.value
        return bytes.subarray(0, testValue.bytes.byteLength)
    }

    toJSON() {
        const runToJson = v => {
            switch (typeof v) {
                case 'undefined':
                    return null
                case 'string': case 'number': case 'boolean':
                    return v
                case 'bigint':
                    return `${v}n`
                case 'object':
                    if (!v) return null
                    let r = {}
                    if (v instanceof Array) {
                        r = []
                        for (const i of v) r.push(runToJson(i))
                    } else {
                        for (const [kk, vv] of (v instanceof Map ? v : Object.entries(v))) r[kk] = runToJson(vv)
                    }
                    return r
            }
        }
        return runToJson(this.value)
    }

}
Object.defineProperty(BaseClass.manifest, 'toJSON', { value: function () { return manifestToJson(BaseClass.manifest) } })

function parseX(xCode, className) {
    if (!xCode || (typeof xCode !== 'string')) return
    xCode = xCode.replace(rx.comments, '').replace(rx.blankLines, '').trim()
    const constants = {}, enums = {}, structs = {}, unions = {}, typedefs = {}
    let namespace = (xCode.match(rx.namespace) ?? [])[1]
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
        const isTypeDef = m[0].slice(0, 8) === 'typedef ', enumName = isTypeDef ? m[4] : m[1], enumBody = isTypeDef ? m[3] : m[2], body = []
        for (const condition of enumBody.split(',')) {
            let [name, value] = condition.split('=').map(s => s.trim())
            if (!name || !value) throw new Error(`enum ${enumName} has invalid condition: ${condition}`)
            let intValue = parseInt(value, value[0] === '0' && value[1] !== '.' && value[1] !== 'x' ? 8 : undefined)
            if (!Number.isInteger(intValue) && (value in constants)) intValue = constants[value]
            if (!Number.isInteger(intValue)) for (const en in enums) if (enums[en].indexOf(value) > -1) { intValue = enums[en].indexOf(value); break }
            if (!Number.isInteger(intValue)) throw new Error(`enum ${enumName} has invalid condition: ${condition}`)
            value = intValue
            body[value] = name
        }
        enums[enumName] = body
        xCode = xCode.replace(m[0], '').replace(rx.blankLines, '').trim()
    }
    const buildStructFromMatch = function (m) {
        const structName = m?.groups?.name ?? m?.groups?.nameTypeDef, structBody = m?.groups?.body ?? m?.groups?.bodyTypeDef, map = new Map()
        for (let declaration of structBody.split('\n')) {
            declaration = declaration.trim()
            if (declaration[declaration.length - 1] === ';') declaration = declaration.slice(0, -1).trim()
            if ((!declaration) || (declaration[0] === ';')) continue
            const { type, length, mode, identifier, optional, unsigned } = parseTypeLengthModeIdentifier(declaration, constants)
            if (!type || !identifier) throw new Error(`struct ${structName} has invalid declaration: ${declaration};`)
            map.set(identifier, { type, length, mode, optional, unsigned })
        }
        return [structName, map]
    }, buildUnionFromMatch = function (m) {
        const unionName = m?.groups?.name ?? m?.groups?.nameTypeDef, unionBody = m?.groups?.body ?? m?.groups?.bodyTypeDef,
            discriminantDeclaration = m?.groups?.discriminant ?? m?.groups?.discriminantTypeDef, arms = {}, queuedArms = [],
            [discriminantType, discriminantValue] = discriminantDeclaration.trim().split(rx.space).map(part => part.trim()),
            discriminant = { type: discriminantType, value: discriminantValue }
        for (let caseSpec of unionBody.split('case ')) {
            caseSpec = caseSpec.trim()
            if (!caseSpec) continue
            let [discriminantValue, armDeclaration] = caseSpec.split(':').map(s => s.trim())
            if (!armDeclaration) { queuedArms.push(discriminantValue); continue }
            if (armDeclaration[armDeclaration.length - 1] === ';') armDeclaration = armDeclaration.slice(0, -1).trim()
            const processArm = (c, cb) => {
                const [name, map] = cb(mm)
                c[name] = map
                arms[discriminantValue] = { type: name }
            }
            switch (armDeclaration.split(rx.space)[0]) {
                case 'struct':
                    for (const mm of `typedef ${armDeclaration};`.matchAll(rx.struct)) processArm(structs, buildStructFromMatch)
                    break
                case 'union':
                    for (const mm of `typedef ${armDeclaration};`.matchAll(rx.union)) processArm(unions, buildUnionFromMatch)
                    break
                default:
                    arms[discriminantValue] = parseTypeLengthModeIdentifier(armDeclaration, constants)
            }
            if (queuedArms.length) for (const d of queuedArms) arms[d] = { ...arms[discriminantValue] }
            queuedArms.length = 0
        }
        return [unionName, discriminant, arms]
    }
    let anonymousFlatStructMatches = Array.from(xCode.matchAll(rx.structAnonymousFlat)), anonymousStructCounter = 0,
        anonymousFlatUnionMatches = Array.from(xCode.matchAll(rx.unionAnonymousFlat)), anonymousUnionCounter = 0
    while (anonymousFlatStructMatches.length || anonymousFlatUnionMatches.length) {
        for (const m of anonymousFlatStructMatches) {
            const [identifier, map] = buildStructFromMatch(m), structName = `anonymousStructType${++anonymousStructCounter}`
            structs[structName] = map
            xCode = xCode.replace(m[0], `\n${structName} ${identifier};\n`).replace(rx.blankLines, '').trim()
        }
        for (const m of anonymousFlatUnionMatches) {
            const [identifier, discriminant, arms] = buildUnionFromMatch(m), unionName = `anonymousUnionType${++anonymousUnionCounter}`
            unions[unionName] = { discriminant, arms }
            xCode = xCode.replace(m[0], `\n${unionName} ${identifier};\n`).replace(rx.blankLines, '').trim()
        }
        anonymousFlatStructMatches = Array.from(xCode.matchAll(rx.structAnonymousFlat))
        anonymousFlatUnionMatches = Array.from(xCode.matchAll(rx.unionAnonymousFlat))
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
    for (const name of Object.keys(structs).concat(Object.keys(unions))) if (!dependedTypes.has(name)) { entry = name; break }
    if (!entry) throw new Error('no entry found')
    const typeClass = class extends BaseClass {
        static entry = entry
        static manifest = {
            ...BaseClass.manifest,
            name: this.name, namespace: this.namespace, entry: this.entry,
            constants, enums, typedefs, unions, structs,
        }
        static name = className
        static namespace = namespace
    }
    Object.defineProperty(typeClass.manifest, 'toJSON', { value: function () { return manifestToJson(typeClass.manifest) } })
    return typeClass
}

function resolveTypeDef(typedef) {
    if (typeof typedef === 'string') typedef = XDR.types[typedef]
    if (!(typedef.prototype instanceof TypeDef)) throw new Error(`Invalid typedef: ${typedef}`)
    return typedef
}

const XDR = {
    createEnum,
    factory: async function (str, options) {
        const namespace = options?.namespace, entry = options?.entry
        let includes = options?.includes ?? this.options.includes, baseUri = options?.baseURI ?? document.baseURI, isURL = !str.includes(';'), typeKey
        if (typeof str !== 'string') throw new Error('Factory requires a string, either a URL to a .X file or .X file type definition as a string')
        if (options?.entry && (options?.name === true)) options.name = options.entry
        if (isURL) str = new URL(str, document.baseURI).href
        typeKey = options?.name ?? (isURL ? str : Array.prototype.map.call(new Uint8Array(await crypto.subtle.digest('SHA-384', new TextEncoder('utf-8').encode(str))),
            x => (('00' + x.toString(16)).slice(-2))).join(''))
        if (!namespace && (typeKey in this.types)) return this.types[typeKey]
        if (namespace) {
            this.types[namespace] ||= {}
            if (typeKey in this.types[namespace]) return this.types[namespace][typeKey]
        }
        if (isURL) {
            baseUri = options?.baseURI ?? (new URL(str, baseUri).href)
            str = await (await fetch(str)).text()
        }
        let includesMatches = Array.from(str.matchAll(rx.includes))
        if (includesMatches.length) {
            const urlsFetched = {}
            while (includesMatches.length) {
                for (const includeMatch of includesMatches) {
                    const includeURL = includes(includeMatch[0], baseUri)
                    str = urlsFetched[includeURL] ? str.replace(includeMatch[0], `\n\n`) : str.replace(includeMatch[0], `\n\n${await (await fetch(includeURL)).text()}\n\n`)
                    urlsFetched[includeURL] = true
                }
                includesMatches = Array.from(str.matchAll(rx.includes))
            }
        }
        const typeClass = parseX(str, typeKey)
        if (entry) typeClass.entry = typeClass.manifest.entry = entry
        if (namespace) typeClass.namespace = namespace
        if (typeClass.namespace) {
            this.types[typeClass.namespace] ||= {}
            return this.types[typeClass.namespace][typeKey] = typeClass
        }
        return this.types[typeKey] = typeClass
    },
    export: function (namespace) {
        const source = namespace ? this.types[namespace] : this.types, retval = {}
        for (const [k, v] of Object.entries(source)) if (v.manifest && v.manifest instanceof Object) retval[k] = JSON.parse(JSON.stringify(v.manifest))
        return retval
    },
    load: async function (types = {}, options = {}, defaultOptions = {}) {
        if (!types || (typeof types !== 'object')) throw new Error('types must be an object')
        if (typeof types !== 'object') throw new Error('options must be an object')
        if (typeof defaultOptions !== 'object') throw new Error('defaultOptions must be an object')
        for (let [typeKey, type] of Object.entries(types)) {
            const typeOptions = { ...(options[typeKey] ?? defaultOptions) }
            if (typeof type === 'string') type = await this.factory(type, typeOptions)
            if (!(type.prototype && (type.prototype instanceof TypeDef)) && type instanceof Object) {
                const typeManifest = { ...type }
                type = class extends BaseClass {
                    static entry = typeOptions.entry ?? typeManifest.entry
                    static manifest = {
                        ...BaseClass.manifest, name: this.name, namespace: this.namespace, entry: this.entry,
                        constants: typeManifest?.constants ?? {}, enums: typeManifest?.enums ?? {},
                        structs: Object.fromEntries(Object.entries(typeManifest?.structs ?? {}).map(([k, v]) => [k, new Map(v)])),
                        typedefs: typeManifest?.typedefs ?? {}, unions: typeManifest?.unions ?? {},
                    }
                    static name = typeOptions.name ?? typeManifest.name
                    static namespace = typeOptions.namespace ?? typeManifest.namespace
                }
                Object.defineProperty(type.manifest, 'toJSON', { value: function () { return manifestToJson(type.manifest) } })
            }
            if (type.namespace) {
                this.types[type.namespace] ||= {}
                this.types[type.namespace][typeKey] = type
            } else {
                this.types[typeKey] = type
            }
        }
    },
    deserialize: function (bytes, typedef, arrayLength, arrayMode, raw) {
        if (!(bytes instanceof Uint8Array)) throw new Error('bytes must be a Uint8Array')
        if (!arrayLength) {
            const r = (new (resolveTypeDef(typedef))(bytes))
            return raw ? r : r.value
        }
        if (arrayMode !== 'variable') arrayMode = 'fixed'
        const arrayActualLength = arrayMode === 'variable' ? TypeDef.getView(bytes).getUint32(0, false) : arrayLength
        if (arrayMode === 'variable') {
            if (arrayActualLength > arrayLength) throw new Error('variable length array exceeds max array length')
            bytes = bytes.subarray(4)
        }
        const result = new Array(arrayActualLength), typeDef = resolveTypeDef(typedef)
        for (const i of result.keys()) {
            const r = new typeDef(bytes)
            result[i] = raw ? r : r.value
            bytes = bytes.subarray(r.bytes.byteLength)
        }
        return result
    },
    serialize: function (value, typedef, arrayLength, arrayMode) {
        const typeDef = resolveTypeDef(typedef)
        if (!arrayLength) return (new typeDef(value)).bytes
        if (!Array.isArray(value)) throw new Error('value must be an array')
        if (arrayMode !== 'variable') arrayMode = 'fixed'
        const arrayActualLength = arrayMode === 'variable' ? value.length : arrayLength
        if (value.length != arrayActualLength) throw new Error('value length must match array length')
        let totalLength = 0
        const chunks = []
        if (arrayMode === 'variable') {
            chunks.push([new intType(arrayActualLength).bytes, totalLength])
            totalLength += 4
        }
        for (const item of value) totalLength += chunks[chunks.push([this.serialize(item, typeDef), totalLength]) - 1][0].length
        let result = new Uint8Array(totalLength)
        for (const chunk of chunks) result.set(...chunk)
        return result
    },
    parse: function (str, typedef, arrayLength, arrayMode, raw) {
        const binaryString = atob(str), bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i)
        return this.deserialize(bytes, typedef, arrayLength, arrayMode, raw)
    },
    stringify: function (value, typedef, arrayLength, arrayMode) { return btoa(String.fromCharCode.apply(null, this.serialize(value, typedef, arrayLength, arrayMode))) },
    types: {
        typedef: TypeDef, bool: boolType, int: intType, hyper: hyperType, float: floatType, double: doubleType,
        opaque: opaqueType, string: stringType, void: voidType
    },
    options: {
        includes: (match, baseUri) => {
            return new URL(match.split('/').pop().split('.').slice(0, -1).concat('x').join('.'), (baseUri ?? document.baseURI)).href
        }
    }
}

export default XDR


/*
TransactionEnvelope: [0,0,0,2,0,0,0,0,208,224,69,231,133,162,31,177,250,104,138,186,172,139,34,137,92,20,18,118,232,19,154,16,194,184,127,216,52,179,47,0,0,15,66,64,0,11,247,65,0,0,0,29,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

    v1 ==> TransactionV1Envelope: [0,0,0,0,208,224,69,231,133,162,31,177,250,104,138,186,172,139,34,137,92,20,18,118,232,19,154,16,194,184,127,216,52,179,47,0,0,15,66,64,0,11,247,65,0,0,0,29,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

        tx ==> Transaction: [0,0,0,0,208,224,69,231,133,162,31,177,250,104,138,186,172,139,34,137,92,20,18,118,232,19,154,16,194,184,127,216,52,179,47,0,0,15,66,64,0,11,247,65,0,0,0,29,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

            *sourceAccount ==> MuxedAccount: [0,0,0,0,208,224,69,231,133,162,31,177,250,104,138,186,172,139,34,137,92,20,18,118,232,19,154,16,194,184,127,216,52,179,47,0,0,15,66,64,0,11,247,65,0,0,0,29,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                *ed25519 ==> uint256 ==> opaque[32]: [208,224,69,231,133,162,31,177,250,104,138,186,172,139,34,137,92,20,18,118,232,19,154,16,194,184,127,216,52,179,47,0,0,15,66,64,0,11,247,65,0,0,0,29,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

            *fee ==> uint32 ==> unsigned int: [0,15,66,64,0,11,247,65,0,0,0,29,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

            *seqNum ==> int64 ==> hyper: [0,11,247,65,0,0,0,29,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

            *cond ==> Preconditions: [0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                *timeBounds ==> TimeBounds: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                    *minTime ==> TimePoint: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                    *maxTime ==> TimePoint: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

            *memo ==> Memo: [0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

            operations ==> Operation[]: [0,0,0,1,0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                0 ==> Operation: [0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                    sourceAccount ==> *MuxedAccount: [0,0,0,1,0,0,0,0,16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                        ed25519 ==> uint256 ==> opaque[32]: [16,125,209,107,44,56,51,72,130,46,129,30,247,170,207,20,209,152,138,111,0,84,114,84,211,62,30,109,134,86,224,156,0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                    body ==> [0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]
                        
                        OperationType type ==> unsigned int: [0,0,0,0,0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                        createAccountOp ==> CreateAccountOp: [0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                            destination ==> AccountID ==> PublicKey: [0,0,0,0,152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                                ed25519 ===> uint256 ==> opaque[32]: [152,54,221,29,212,212,36,59,153,48,106,166,194,154,104,45,55,50,154,78,75,37,151,236,2,49,158,35,170,99,124,114,0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                            startingBalance ==> int64 ==> hyper: [0,0,0,23,72,118,232,0,0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

            ext ==> [0,0,0,0,0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

        signatures ==> DecoratedSignature<20> [0,0,0,2,52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]
            
            0 ==> DecoratedSignature: [52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                hint ==> SignatureHint ==> opaque[4]: [52,179,47,0,0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                signature ==> Signature ==> opaque<64>: [0,0,0,64,99,30,16,82,99,38,101,152,96,227,61,86,66,230,51,79,45,96,143,67,175,46,31,63,142,7,199,152,44,150,145,219,195,191,51,105,38,143,140,19,8,71,158,192,153,99,113,186,37,11,251,144,4,88,216,153,241,155,116,155,132,47,254,11,134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

            1 ==> DecoratedSignature: [134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                hint ==> SignatureHint ==> opaque[4]: [134,86,224,156,0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]

                signature ==> Signature ==> opaque<64>: [0,0,0,64,214,109,20,189,194,246,196,3,234,52,210,8,146,78,104,179,36,13,181,48,187,220,215,174,37,13,36,150,10,47,54,118,15,137,157,67,40,210,187,120,156,75,238,247,68,202,155,0,104,134,229,86,168,244,179,94,50,82,253,28,73,7,156,0]



struct Transaction
{
    // account used to run the transaction
    MuxedAccount sourceAccount;

    // the fee the sourceAccount will pay
    uint32 fee;

    // sequence number to consume in the account
    SequenceNumber seqNum;

    // validity conditions
    Preconditions cond;

    Memo memo;

    Operation operations<MAX_OPS_PER_TX>;

    // reserved for future use
    union switch (int v)
    {
    case 0:
        void;
    case 1:
        SorobanTransactionData sorobanData;
    }
    ext;
};

*/