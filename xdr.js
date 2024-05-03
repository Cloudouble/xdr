class TypeDef {

    #bytes
    #value

    static isImplicitArray = false
    static minBytesLength = 0
    static valueProperty = 'value'
    static deserialize(bytes, parameters = {}) { return }
    static getView(i, byteOffset, byteLength) {
        if (typeof i === 'number') return new DataView(new ArrayBuffer(i))
        if (i instanceof Uint8Array) return new DataView(i.buffer, i.byteOffset + (byteOffset ?? 0), byteLength ?? i.byteLength)
    }
    static isMinBytesInput(bytes) { return Number.isInteger(this.minBytesLength) ? (bytes.length >= this.minBytesLength) : true }
    static isValueInput(input) { return !(input instanceof Uint8Array) }
    static serialize(value, parameters = {}) { return new Uint8Array() }

    constructor(input, parameters = {}) {
        if (input instanceof Uint8Array) {
            const consumeResult = this.#consume(input, parameters), isConsumeResultArray = Array.isArray(consumeResult)
            this.#bytes = isConsumeResultArray ? consumeResult[0] : consumeResult
            if (isConsumeResultArray && consumeResult.length > 1) this.#value = consumeResult[1]
        } else if (this.constructor.isValueInput(input)) {
            this.#value = input
        } else {
            throw new Error(`Invalid input for ${this.constructor.name}: ${input}`)
        }
        Object.defineProperties(this, {
            bytes: { get: () => this.#bytes ??= this.constructor.serialize(this.#value, parameters), enumerable: true },
            value: { get: () => this.#value ??= this.constructor.deserialize(this.#bytes, parameters), enumerable: true }
        })
    }

    consume(bytes, parameters = {}) { return bytes.subarray(0, this.constructor.minBytesLength) }

    toJSON() { return this[this.constructor.valueProperty ?? 'value'] == undefined ? null : this[this.constructor.valueProperty ?? 'value'] }
    toString() {
        const chunkSize = 32768, chunks = [];
        for (let i = 0; i < this.bytes.length; i += chunkSize) chunks.push(String.fromCharCode.apply(null, this.bytes.slice(i, i + chunkSize)));
        return btoa(chunks.join(''))
    }
    valueOf() { return this[this.constructor.valueProperty ?? 'value'] }

    #consume(bytes, parameters = {}) {
        if (!this.constructor.isMinBytesInput(bytes)) throw new Error(`Insufficient consumable byte length for ${this.constructor.name}: ${bytes.length}`)
        return this.consume(bytes, parameters)
    }

}

class int extends TypeDef {

    static minBytesLength = 4
    static deserialize(bytes) { return this.getView(bytes)[this.unsigned ? 'getUint32' : 'getInt32'](0, false) }
    static isValueInput(input) { return Number.isInteger(input) }
    static serialize(value) {
        const view = this.getView(4)
        view[this.unsigned ? 'setUint32' : 'setInt32'](0, value, false)
        return new Uint8Array(view.buffer)
    }

    constructor(input, parameters = {}) {
        super(input)
        const { unsigned } = parameters
        this.unsigned = this.constructor.isValueInput(input) ? input >= 0 : !!unsigned
    }

}

class hyper extends int {

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

class float extends TypeDef {

    static minBytesLength = 4
    static deserialize(bytes) { return this.getView(bytes).getFloat32(0, false) }
    static isValueInput(input) { return typeof input === 'number' }
    static serialize(value) {
        const view = this.getView(4)
        view.setFloat32(0, value, false)
        return new Uint8Array(view.buffer)
    }

}

class double extends float {

    static minBytesLength = 8
    static deserialize(bytes) { return this.getView(bytes).getFloat64(0, false) }
    static serialize(value) {
        const view = this.getView(8)
        view.setFloat64(0, value, false)
        return new Uint8Array(view.buffer)
    }

}

class opaque extends TypeDef {

    static parameters = ['length', 'mode']
    static isImplicitArray = true
    static deserialize(bytes, parameters = {}) {
        if (parameters.mode !== 'variable') parameters.mode = 'fixed'
        const { mode } = parameters
        if (mode === 'fixed') return Array.from(bytes)
        const maxOffset = this.getView(bytes).getUint32(0, false) + 4, data = []
        for (let offset = 4; offset < maxOffset; offset++) data.push(bytes[offset])
        return data
    }
    static isValueInput(input) { return Array.isArray(input) }
    static serialize(value, parameters = {}) {
        const { length = this.length, mode = this.mode } = parameters,
            bytes = new Uint8Array(Math.ceil((mode === 'fixed' ? length : (4 + value.length)) / 4) * 4)
        if (mode === 'variable') {
            const view = this.getView(4)
            view.setUint32(0, value.length, false)
            bytes.set(new Uint8Array(view.buffer))
        }
        bytes.set(value, mode === 'fixed' ? 0 : 4)
        return bytes
    }

    constructor(input, parameters = {}) {
        if (parameters.mode !== 'variable') parameters.mode = 'fixed'
        const { length = input.length, mode } = parameters, isValueInput = Array.isArray(input)
        super(input, { length, mode, isValueInput })
        if (mode === 'fixed' && isValueInput && (input.length !== length)) throw new Error(`Fixed value length mismatch for ${this.constructor.name}: ${input.length}!= ${length}`)
        Object.defineProperties(this, { length: { value: length, enumerable: true }, mode: { value: mode, enumerable: true } })
    }

    consume(bytes, parameters = {}) {
        const { length, mode, isValueInput } = parameters
        if (isValueInput) return [this.constructor.serialize(bytes, { mode, length }), Array.from(bytes)]
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

class string extends TypeDef {

    #length

    static parameters = ['length']
    static deserialize(bytes) {
        const maxOffset = this.getView(bytes).getUint32(0, false) + 4, chars = [], decoder = new TextDecoder()
        for (let offset = 4; offset < maxOffset; offset++) chars.push(decoder.decode(bytes.subarray(offset, offset + 1)))
        return chars.join('')
    }
    static isValueInput(input) { return typeof input === 'string' }
    static serialize(value) {
        const stringBytes = (new TextEncoder()).encode(value), view = this.getView(4), bytes = new Uint8Array(4 + (Math.ceil(stringBytes.length / 4) * 4))
        view.setUint32(0, stringBytes.length, false)
        bytes.set(new Uint8Array(view.buffer))
        bytes.set(stringBytes, 4)
        return bytes
    }

    constructor(input, parameters = {}) {
        super(input, parameters)
        this.#length = parameters.length
    }

    consume(bytes, parameters = {}) {
        const { length } = parameters, stringLength = this.constructor.getView(bytes).getUint32(0, false), consumeLength = Math.ceil(stringLength / 4) * 4
        if (length && (stringLength > length)) throw new Error(`Maximum length exceeded for ${this.constructor.name}: ${stringLength}`)
        if (bytes.length < (4 + consumeLength)) throw new Error(`Insufficient consumable byte length for ${this.constructor.name}: ${bytes.length}`)
        return bytes.subarray(0, 4 + consumeLength)
    }

    get length() { return this.#length }

}

class voidType extends TypeDef {

    static deserialize() { return null }
    static isValueInput(input) { return input == null }

}

const createEnum = function (body, name, entry, namespace, manifest = {}) {
    body ||= 0
    if (body && (!Array.isArray(body) || !body.length ||
        !(body.every(i => (i == null || typeof i === 'string')) || body.every(i => (i == null || typeof i === 'boolean')))))
        throw new Error(`Enum must have a body array of string or boolean identifiers: body: ${JSON.stringify(body)}, name: ${name}`)
    return class extends int {

        static entry = entry
        static name = name
        static namespace = namespace
        static manifest = manifest
        static valueProperty = 'identifier'

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
            if (this.#body && (this.#identifier === undefined)) throw new Error(`No valid enum identifier found for ${typeof originalInput}: ${originalInput}`)
        }

        get identifier() { return this.#identifier }
        get body() { return this.#body }

    }
}, manifestToJson = manifest => {
    const retval = {}
    for (const key in manifest) {
        switch (typeof manifest[key]) {
            case 'undefined': case 'function': continue
            case 'object':
                if (key === 'structs') {
                    retval.structs = {}
                    for (const structName in manifest.structs) retval.structs[structName] = JSON.parse(JSON.stringify(Array.from(manifest.structs[structName].entries())))
                    continue
                }
                retval[key] = JSON.parse(JSON.stringify(manifest[key]))
                break
            default:
                retval[key] = manifest[key]
        }
    }
    return retval
}, defaultParameters = { length: 0, mode: 'fixed', optional: false, unsigned: false }, parameters = { ...defaultParameters, mode: 'variable' },
    unsignedParameters = { ...defaultParameters, unsigned: true }, optionalParameters = { ...defaultParameters, optional: true }, bool = createEnum([false, true], 'bool'),
    parametersCollection = { defaultParameters, parameters, unsignedParameters, optionalParameters }
Object.defineProperties(bool.prototype, { valueOf: { value: function () { return !!this.value } }, toJSON: { value: function () { return !!this.value } } })

const BaseClass = class extends TypeDef {

    static entry
    static name
    static namespace
    static manifest = {}
    static serialize(value, declaration) {
        const type = declaration?.type ?? this.manifest.entry
        let result
        if (!type) throw new Error(`No type found in declaration`)
        if (type in this.manifest.enums) return (new (createEnum(this.manifest.enums[type], type))(value)).bytes
        declaration ??= this.manifest.structs[type] ?? this.manifest.unions[type] ?? this.manifest.typedefs[type]
        if (!declaration) throw new Error(`No type declaration found for type ${type}`)
        const { parameters = { ...defaultParameters } } = declaration, runSerialize = (v, cb) => {
            if (((parameters.mode === 'variable') || parameters.length) && Array.isArray(v)) {
                let totalLength = 0
                const chunks = [[new int(v.length).bytes, totalLength]]
                totalLength += 4
                for (const item of v) totalLength += chunks[chunks.push([cb(item), totalLength]) - 1][0].length
                let r = new Uint8Array(totalLength)
                for (const chunk of chunks) r.set(...chunk)
                return r
            }
            return cb(v)
        }
        if (type in XDR.types._core) {
            result = (new XDR.types._core[type](value, parameters)).bytes
        } else if (type in this.manifest.typedefs) {
            result = this.manifest.typedefs[type].type === 'opaque' ? this.serialize(value, { ...this.manifest.typedefs[type] })
                : runSerialize(value, itemValue => this.serialize(itemValue, { ...this.manifest.typedefs[type], parameters: { ...defaultParameters } }))
        } else if (type in this.manifest.structs) {
            result = runSerialize(value, itemValue => {
                const itemChunks = []
                let itemTotalLength = 0
                for (let [id, dec] of this.manifest.structs[type].entries()) {
                    const hasField = itemValue[id] !== undefined ? 1 : 0, { parameters: p = { ...defaultParameters } } = dec
                    if (p.optional) {
                        itemChunks.push([new Uint8Array([0, 0, 0, hasField]), itemTotalLength])
                        itemTotalLength += 4
                        if (!hasField) continue
                        dec = { ...dec, parameters: { ...p, optional: false } }
                    } else {
                        if (!hasField) throw new Error(`Missing required field in ${type}: ${id}, ${JSON.stringify(itemValue)}`)
                    }
                    itemTotalLength += itemChunks[itemChunks.push([this.serialize(itemValue[id], dec), itemTotalLength]) - 1][0].length
                }
                const itemResult = new Uint8Array(itemTotalLength)
                for (const chunk of itemChunks) itemResult.set(...chunk)
                return itemResult
            })
        } else if (type in this.manifest.unions) {
            const unionManifest = this.manifest.unions[type], enumClass = createEnum(this.manifest.enums[unionManifest.discriminant.type], unionManifest.discriminant.type)
            result = runSerialize(value, itemValue => {
                const enumIdentifier = itemValue[unionManifest.discriminant.identifier], discriminantBytes = (new enumClass(enumIdentifier)).bytes,
                    armManifest = unionManifest.arms[enumIdentifier], armBytes = this.serialize(itemValue[armManifest.identifier], unionManifest.arms[enumIdentifier]),
                    itemResult = new Uint8Array(discriminantBytes.length + armBytes.length)
                itemResult.set(discriminantBytes, 0)
                itemResult.set(armBytes, discriminantBytes.length)
                return itemResult
            })
        }
        return result
    }

    static deserialize(bytes, declaration, raw, isArrayItem) {
        const type = declaration?.type ?? this.manifest.entry
        let result
        if (!type) throw new Error(`No type found in declaration`)
        if (type in this.manifest.enums) {
            result = new (createEnum(this.manifest.enums[type], type))(bytes)
            return raw ? result : result.identifier
        }
        declaration ??= this.manifest.structs[type] ?? this.manifest.unions[type] ?? this.manifest.typedefs[type]
        if (!declaration) throw new Error(`No type declaration found for type ${type}`)
        const { parameters = { ...defaultParameters } } = declaration, runDeserialize = (b, bl, d, iai) => {
            const r = this.deserialize(b, d, true, iai)
            return [bl + r.bytes.byteLength, r[r.constructor.valueProperty ?? 'value'], b.subarray(r.bytes.byteLength)]
        }
        if (type in XDR.types._core) {
            result = (new XDR.types._core[type](bytes, parameters))
            return raw ? result : result[type === 'bool' ? 'identifier' : 'value']
        } else if (type in this.manifest.typedefs) {
            result = this.deserialize(bytes, { ...this.manifest.typedefs[type], identifier: declaration.identifier }, true)
        } else if (type in this.manifest.structs) {
            const value = {}
            let byteLength = 0, entryResult
            for (let [id, dec] of this.manifest.structs[type].entries()) {
                const p = dec.parameters ?? { ...defaultParameters }
                if (p.optional) {
                    const hasField = !!this.getView(bytes).getUint32(0, false)
                    bytes = bytes.subarray(4)
                    byteLength += 4
                    if (!hasField) continue
                }
                if (((p.mode === 'variable') || p.length) && !XDR.types._core[dec.type]) {
                    const declarationVariableLength = p.mode === 'variable' ? this.getView(bytes).getUint32(0, false) : p.length
                    if (p.mode === 'variable') {
                        if (p.length && (declarationVariableLength > p.length)) throw new Error('Variable length exceeds declaration length')
                        bytes = bytes.subarray(4)
                        byteLength += 4
                    }
                    entryResult = new Array(declarationVariableLength)
                    for (const i of entryResult.keys()) [byteLength, entryResult[i], bytes] = runDeserialize(bytes, byteLength, { ...dec, parameters: { ...p, length: 0, mode: 'fixed' } }, true)
                    value[id] = entryResult
                } else {
                    [byteLength, value[id], bytes] = runDeserialize(bytes, byteLength, dec, true)
                }
            }
            result = { value, bytes: { byteLength } }
        } else if (type in this.manifest.unions) {
            let byteLength = 0, discriminantInstance
            const unionManifest = this.manifest.unions[type], enumClass = createEnum(this.manifest.enums[unionManifest.discriminant.type],
                unionManifest.discriminant.type), enumValue = this.getView(bytes).getUint32(0, false)
            bytes = bytes.subarray(4)
            byteLength += 4
            try { discriminantInstance = new enumClass(enumValue) } catch (e) { discriminantInstance = new enumClass(0) }
            let armDeclaration = unionManifest.arms[discriminantInstance.identifier], armResult
            if (armDeclaration === undefined) {
                discriminantInstance = new enumClass(0)
                armDeclaration = unionManifest.arms[discriminantInstance.identifier]
            }
            if (isArrayItem) armDeclaration = { ...armDeclaration, parameters: { ...(armDeclaration.parameters ?? {}), length: 0, mode: 'fixed' } }
            const value = { [unionManifest.discriminant.identifier]: discriminantInstance.identifier },
                { identifier, type: armType } = armDeclaration,
                { length: armLength, mode: armMode } = armDeclaration.parameters ?? { ...defaultParameters }
            if (armLength && !(armType in !XDR.types._core)) {
                const armVariableLength = armMode === 'variable' ? this.getView(bytes).getUint32(0, false) : armLength
                if (armMode === 'variable') {
                    bytes = bytes.subarray(4)
                    byteLength += 4
                    if (armVariableLength > armLength) throw new Error('Variable length exceeds arm declaration length')
                }
                armResult = new Array(armVariableLength)
                for (const i of armResult.keys()) [byteLength, armResult[i], bytes] = runDeserialize(bytes, byteLength,
                    { ...armDeclaration, parameters: { ...(armDeclaration.parameters ?? {}), length: 0, mode: 'fixed' } }, true)
                if (identifier) value[identifier] = armResult
            } else {
                let r
                [byteLength, r, bytes] = runDeserialize(bytes, byteLength, armDeclaration, true)
                if (identifier) value[identifier] = r
            }
            result = { value, bytes: { byteLength } }
        }
        return raw ? result : result[result.constructor.valueProperty ?? 'value']
    }

    consume(bytes, parameters = {}) {
        const newBytes = bytes.slice(0), testValue = this.constructor.deserialize(newBytes, undefined, true)
        this.value ??= testValue.value
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
        return runToJson(this[this.constructor.valueProperty ?? 'value'])
    }

}
Object.defineProperty(BaseClass.manifest, 'toJSON', { value: function () { return manifestToJson(BaseClass.manifest) } })

const XDR = {
    version: '1.2.0',
    types: { _anon: {}, _base: { TypeDef, BaseClass }, _core: { bool, int, hyper, float, double, opaque, string, void: voidType, typedef: TypeDef } },
    options: {
        includes: (match, baseUri) => new URL(match.split('/').pop().split('.').slice(0, -1).concat('x').join('.'), (baseUri ?? document.baseURI)).href,
        cacheExpiry: 10000
    },
    deserialize: function (bytes, typeDef, parameters = {}, raw = false) {
        const { length, mode } = parameters
        if (!(bytes instanceof Uint8Array)) throw new Error('bytes must be a Uint8Array')
        if (!(typeDef.prototype instanceof TypeDef)) throw new Error(`Invalid typeDef: ${typeDef} `)
        if (!length || typeDef.isImplicitArray) {
            const r = new typeDef(bytes, (typeDef.isImplicitArray ? { length, mode } : {}))
            return raw ? r : r[r.constructor.valueProperty ?? 'value']
        }
        if (mode !== 'variable') mode = 'fixed'
        const arrayActualLength = mode === 'variable' ? typeDef.getView(bytes).getUint32(0, false) : length
        if (mode === 'variable') {
            if (arrayActualLength > length) throw new Error('Variable length array exceeds max array length')
            bytes = bytes.subarray(4)
        }
        const result = new Array(arrayActualLength)
        for (const i of result.keys()) {
            const r = new typeDef(bytes)
            result[i] = raw ? r : r[r.constructor.valueProperty ?? 'value']
            bytes = bytes.subarray(r.bytes.byteLength)
        }
        return result
    },
    serialize: function (value, typeDef, parameters = {}) {
        const { length, mode } = parameters
        if (!(typeDef.prototype instanceof TypeDef)) throw new Error(`Invalid typeDef: ${typeDef} `)
        if (!length || typeDef.isImplicitArray) return (new typeDef(value, (typeDef.isImplicitArray ? { length, mode } : {}))).bytes
        if (!Array.isArray(value)) throw new Error('value must be an array')
        if (mode !== 'variable') mode = 'fixed'
        const arrayActualLength = mode === 'variable' ? value.length : length, chunks = []
        if (value.length != arrayActualLength) throw new Error('value length must match array length')
        let totalLength = 0
        if (mode === 'variable') {
            chunks.push([new int(arrayActualLength).bytes, totalLength])
            totalLength += 4
        }
        for (const item of value) totalLength += chunks[chunks.push([this.serialize(item, typeDef), totalLength]) - 1][0].length
        let result = new Uint8Array(totalLength)
        for (const chunk of chunks) result.set(...chunk)
        return result
    },
    parse: function (str, typedef, parameters = {}, raw = false) {
        const binaryString = atob(str), bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i)
        return this.deserialize(bytes, typedef, parameters, raw)
    },
    stringify: function (value, typedef, parameters = {}) { return btoa(String.fromCharCode.apply(null, this.serialize(value, typedef, parameters))) },
    import: async function (typeCollection = {}, options = {}, namespace = undefined, format = undefined) {
        if (typeof typeCollection === 'string') {
            typeCollection = typeCollection.trim()
            if (typeCollection[0] === '/' || typeCollection[0] === '.' || typeCollection.endsWith('.xdr') || typeCollection.endsWith('.json') || typeCollection.includes('.') || typeCollection.includes(':')) {
                if (!format && typeCollection.endsWith('.xdr')) format = 'xdr'
                if (!format && typeCollection.endsWith('.json')) format = 'json'
                typeCollection = (await fetch(typeCollection).then(r => r.text())).trim()
            }
            if (!format) format = typeCollection[0] === '{' ? 'json' : 'xdr'
            format = format === 'json' ? 'json' : 'xdr'
            if (!this.types._base.TypeCollection) await this.createTypeCollection()
            typeCollection = format === 'json' ? JSON.parse(typeCollection) : this.parse(typeCollection, this.types._base.TypeCollection)
        } else {
            if (!this.types._base.TypeCollection) await this.createTypeCollection()
            if ((typeCollection instanceof this.types._base.TypeCollection)) typeCollection = typeCollection.value
        }
        if (!typeCollection || (typeof typeCollection !== 'object')) throw new Error('typeCollection must be an object')
        if (typeof options !== 'object') throw new Error('options must be an object')
        const { library, types } = typeCollection
        if (!library || !(library instanceof Object)) throw new Error('typeCollection.library must be an object')
        if (!types || !Array.isArray(types)) throw new Error('typeCollection.types must be an array')
        if (library.enums) {
            for (const en of library.enums) {
                const body = []
                for (const i of en.body) body[i.value] = i.identifier
                en.body = body
            }
            library.enums = Object.fromEntries(library.enums.map(en => [en.key, en.body]))
        }
        if (library.structs) {
            const structs = {}
            for (const st of library.structs) {
                structs[st.key] = new Map()
                for (const p of st.properties) structs[st.key].set(p.identifier, p)
            }
            library.structs = structs
        }
        if (library.typedefs) {
            const typedefs = {}
            for (const td of library.typedefs) typedefs[td.key] = td.declaration
            library.typedefs = typedefs
        }
        if (library.unions) {
            const unions = {}
            for (const un of library.unions) {
                unions[un.key] = { arms: {}, discriminant: un.discriminant }
                for (const a of un.arms) unions[un.key].arms[a.arm] = a
            }
            library.unions = unions
        }
        for (const typeEntry of types) {
            const { key, manifest: manifestSummary } = typeEntry, manifest = {}
            manifest.name = ((options[key] ?? {}).name ?? key)
            manifest.entry ??= ((options[key] ?? {}).entry ?? manifestSummary.entry ?? manifest.name)
            manifest.namespace ??= ((options[key] ?? {}).namespace ?? namespace)
            for (const scope in library) {
                manifest[scope] = {}
                for (const typeName of (manifestSummary[scope] ?? [])) if (library[scope][typeName]) manifest[scope][typeName] = library[scope][typeName]
            }
            const typeClass = class extends BaseClass {
                static entry = manifest.entry
                static name = manifest.name
                static namespace = manifest.namespace
                static manifest = { ...BaseClass.manifest, ...manifest }
            }
            Object.defineProperty(typeClass.manifest, 'toJSON', { value: function () { return manifestToJson(typeClass.manifest) } })
            this.types[manifest.namespace ?? '_anon'] ||= {}
            this.types[manifest.namespace ?? '_anon'][key] = typeClass
        }
    },
    factory: async function (xCode, entry, options = {}) {
        if (!this._factory) Object.defineProperty(this, '_factory', { value: (await import('./lib/factory.js')).default.bind(this) })
        return this._factory(xCode, entry, options)
    },
    export: async function (namespace = '_anon', format = 'xdr', raw = false) {
        if (!this._export) Object.defineProperty(this, '_export', { value: (await import('./lib/export.js')).default.bind(this) })
        return this._export(namespace, format, raw)
    }
}
Object.defineProperties(XDR, {
    createEnum: { value: createEnum },
    createTypeCollection: { value: async () => XDR.types._base.TypeCollection = ((await import('./lib/type-collection-factory.js')).default.bind(XDR))() },
    manifestToJson: { value: manifestToJson },
    parametersCollection: { value: parametersCollection },
    _cache: { value: {} }
})

export default XDR
