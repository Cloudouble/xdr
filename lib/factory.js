const rx = {
    'const': /const\s+([A-Z_]+)\s*=\s*(0[xX][\dA-Fa-f]+|0[0-7]*|\d+)\s*;/g, 'enum': /enum\s+(\w+)\s*\{([\s\S]*?)\}\s*;|typedef\s+enum\s*\{([\s\S]*?)\}\s+(\w+);/g,
    struct: /struct\s+(?<name>\w+)\s*\{(?<body>[^\{\}]*?)\}\s*;|typedef\s+struct\s*\{(?<bodyTypeDef>[^\{\}]*?)\}\s+(?<nameTypeDef>\w+)\s*;/g,
    union: /union\s+(?<name>\w+)\s+switch\s*\((?<discriminant>[^\)]+?)\)\s*\{(?<body>[^\{\}]*?)\}\s*;|typedef\s+union\s+switch\s*\((?<discriminantTypeDef>[^\)]+?)\)\s*\{(?<bodyTypeDef>[^\{\}]*?)\}\s+(?<nameTypeDef>\w+)\s*;/g,
    structAnonymousFlat: /struct\s*\{(?<body>[^\{\}]*?)\}\s+(?<name>\w+)\s*;/g,
    unionAnonymousFlat: /union\s+switch\s*\((?<discriminant>[^\)]+?)\)\s*\{(?<body>[^\{\}]*?)\}\s+(?<name>\w+)\s*;/g,
    typedef: /typedef\s+((unsigned)\s+)?(\w+)\s+([\w\[\]\<\>\*]+)\s*;/g, namespace: /^\s*namespace\s+([\w]+)\s*\{/m,
    includes: /\%\#include\s+\".+\"/g, unsigned: /^unsigned\s+/, space: /\s+/, comments: /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    blankLines: /^\s*[\r\n]/gm, dashes: /-/g
}, factory = async function (xCode, entry, options = {}) {
    if (typeof xCode !== 'string') throw new Error('Factory requires an xCode string, either a URL to a .X file or .X file type definition as a string')
    const $this = this, parseX = (xCode, entry, name) => {
        if (!xCode || (typeof xCode !== 'string')) throw new Error('No valid xCode defined')
        xCode = xCode.replace(rx.comments, '').replace(rx.blankLines, '').trim()
        if (!xCode) throw new Error('No xCode supplied')
        if (!entry) throw new Error('No entry defined')
        const { defaultParameters } = this.parametersCollection, parseTypeLengthModeIdentifier = function (declaration, constants) {
            let unsigned = declaration.slice(0, 9) === 'unsigned ' ? true : undefined,
                [type, identifier] = declaration.replace(rx.unsigned, '').split(rx.space).map(part => part.trim()), length, mode,
                identifierHasStar = identifier && (identifier[0] === '*'), typeHasStar = type && type.endsWith('*'),
                optional = identifierHasStar || typeHasStar
            if (identifierHasStar) identifier = identifier.slice(1)
            if (typeHasStar) type = type.slice(0, -1)
            if (type === 'void') {
                const voidReturn = { type }
                if (identifier) voidReturn.identifier = identifier
                if (optional) voidReturn.parameters = { ...defaultParameters, optional }
                return voidReturn
            }
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
            const parameters = {}, rawParameters = { length, mode, optional, unsigned }
            for (const param of ['length', 'mode', 'optional', 'unsigned']) {
                if ((rawParameters[param] !== undefined) && (rawParameters[param] !== defaultParameters[param])) parameters[param] = rawParameters[param]
            }
            const retval = { type }
            if (identifier) retval.identifier = identifier
            if (Object.keys(parameters).length) retval.parameters = parameters
            return retval
        }
        name ??= entry
        const constants = {}, enums = {}, structs = {}, unions = {}, typedefs = {}, cleanXCode = (s, r = '') => xCode.replace(s, r).replace(rx.blankLines, '').trim()
        let namespace = (xCode.match(rx.namespace) ?? [])[1]
        for (const m of xCode.matchAll(rx.const)) {
            constants[m[1]] = parseInt(m[2], m[2][0] === '0' && m[2][1] !== '.' && m[2][1] !== 'x' ? 8 : undefined)
            xCode = cleanXCode(m[0])
        }
        for (const t of xCode.matchAll(rx.typedef)) {
            const declaration = parseTypeLengthModeIdentifier(t[2] ? `${t[2]} ${t[3]} ${t[4]}` : `${t[3]} ${t[4]}`, constants)
            const identifier = declaration.identifier
            delete declaration.identifier
            typedefs[identifier] = declaration
            if (declaration.parameters) declaration.parameters = { ...defaultParameters, ...declaration.parameters }
            xCode = cleanXCode(t[0])
        }
        for (const m of xCode.matchAll(rx.enum)) {
            const isTypeDef = m[0].slice(0, 8) === 'typedef ', enumName = isTypeDef ? m[4] : m[1], enumBody = isTypeDef ? m[3] : m[2], body = []
            for (const condition of enumBody.split(',')) {
                let [conditionName, value] = condition.split('=').map(s => s.trim())
                if (!conditionName || !value) throw new Error(`Enum ${enumName} has invalid condition: ${condition}`)
                let intValue = parseInt(value, value[0] === '0' && value[1] !== '.' && value[1] !== 'x' ? 8 : undefined)
                if (!Number.isInteger(intValue) && (value in constants)) intValue = constants[value]
                if (!Number.isInteger(intValue)) for (const en in enums) if (enums[en].indexOf(value) > -1) { intValue = enums[en].indexOf(value); break }
                if (!Number.isInteger(intValue)) throw new Error(`Enum ${enumName} has invalid condition: ${condition}`)
                value = intValue
                body[value] = conditionName
            }
            enums[enumName] = body
            xCode = cleanXCode(m[0])
        }
        const buildStructFromMatch = function (m) {
            const structName = m?.groups?.name ?? m?.groups?.nameTypeDef, structBody = m?.groups?.body ?? m?.groups?.bodyTypeDef, map = new Map()
            for (let declaration of structBody.split('\n')) {
                declaration = declaration.trim()
                if (declaration[declaration.length - 1] === ';') declaration = declaration.slice(0, -1).trim()
                if ((!declaration) || (declaration[0] === ';')) continue
                const propertyDeclaration = parseTypeLengthModeIdentifier(declaration, constants)
                if (!propertyDeclaration.type || !propertyDeclaration.identifier) throw new Error(`Struct ${structName} has invalid declaration: ${declaration};`)
                const propertyIdentifier = propertyDeclaration.identifier
                delete propertyDeclaration.identifier
                if (propertyDeclaration.parameters) propertyDeclaration.parameters = { ...defaultParameters, ...propertyDeclaration.parameters }
                map.set(propertyIdentifier, propertyDeclaration)
            }
            return [structName, map]
        }, buildUnionFromMatch = function (m) {
            const unionName = m?.groups?.name ?? m?.groups?.nameTypeDef, unionBody = m?.groups?.body ?? m?.groups?.bodyTypeDef,
                discriminantDeclaration = m?.groups?.discriminant ?? m?.groups?.discriminantTypeDef, arms = {}, queuedArms = [],
                [discriminantType, discriminantIdentifier] = discriminantDeclaration.trim().split(rx.space).map(part => part.trim()),
                discriminant = { type: discriminantType, identifier: discriminantIdentifier }, processArm = (c, cb, mm, dv) => {
                    const [n, map] = cb(mm)
                    c[n] = map
                    arms[dv] = { type: n }
                }
            for (let caseSpec of unionBody.split('case ')) {
                caseSpec = caseSpec.trim()
                if (!caseSpec) continue
                let [discriminantIdentifier, armDeclaration] = caseSpec.split(':').map(s => s.trim())
                if (armDeclaration[armDeclaration.length - 1] === ';') armDeclaration = armDeclaration.slice(0, -1).trim()
                if (!armDeclaration) { queuedArms.push(discriminantIdentifier); continue }
                switch (armDeclaration.split(rx.space)[0]) {
                    case 'struct':
                        for (const mm of `typedef ${armDeclaration};`.matchAll(rx.struct)) processArm(structs, buildStructFromMatch, mm, discriminantIdentifier)
                        break
                    case 'union':
                        for (const mm of `typedef ${armDeclaration};`.matchAll(rx.union)) processArm(unions, buildUnionFromMatch, mm, discriminantIdentifier)
                        break
                    default:
                        arms[discriminantIdentifier] = parseTypeLengthModeIdentifier(armDeclaration, constants)
                        arms[discriminantIdentifier].arm = discriminantIdentifier
                        if (arms[discriminantIdentifier].parameters) arms[discriminantIdentifier].parameters = { ...defaultParameters, ...arms[discriminantIdentifier].parameters }
                }
                if (queuedArms.length) for (const d of queuedArms) arms[d] = { ...arms[discriminantIdentifier] }
                queuedArms.length = 0
            }
            return [unionName, discriminant, arms]
        }
        let aStructMatches = Array.from(xCode.matchAll(rx.structAnonymousFlat)), aUnionMatches = Array.from(xCode.matchAll(rx.unionAnonymousFlat))
        while (aStructMatches.length || aUnionMatches.length) {
            for (const m of aStructMatches) {
                const [identifier, map] = buildStructFromMatch(m), structName = `aStruct${crypto.randomUUID().replace(rx.dashes, '')}`
                structs[structName] = map
                xCode = cleanXCode(m[0], `\n${structName} ${identifier};\n`)
            }
            for (const m of aUnionMatches) {
                const [identifier, discriminant, arms] = buildUnionFromMatch(m), unionName = `aUnion${crypto.randomUUID().replace(rx.dashes, '')}`
                unions[unionName] = { discriminant, arms }
                xCode = cleanXCode(m[0], `\n${unionName} ${identifier};\n`)
            }
            aStructMatches = Array.from(xCode.matchAll(rx.structAnonymousFlat))
            aUnionMatches = Array.from(xCode.matchAll(rx.unionAnonymousFlat))
        }
        for (const m of xCode.matchAll(rx.union)) {
            const [unionName, discriminant, arms] = buildUnionFromMatch(m)
            unions[unionName] = { discriminant, arms }
            xCode = cleanXCode(m[0])
        }
        for (const m of xCode.matchAll(rx.struct)) {
            const [structName, map] = buildStructFromMatch(m)
            structs[structName] = map
            xCode = cleanXCode(m[0])
        }
        const all = { structs, unions, typedefs, enums }, used = { structs: {}, unions: {}, typedefs: {}, enums: {} }, allUsed = new Set(),
            addUsedMembers = typeName => {
                if (allUsed.has(typeName)) return
                const [typeIsMemberOf, entries] = typeName in unions
                    ? ['unions', Object.entries(unions[typeName].arms)] : (typeName in structs
                        ? ['structs', structs[typeName].entries()] : (typeName in typedefs
                            ? ['typedefs', [[0, typedefs[typeName]]]] : (typeName in enums ? ['enums', []] : [undefined, undefined])))
                if (!typeIsMemberOf) return
                switch (typeIsMemberOf) {
                    case 'structs':
                        used[typeIsMemberOf][typeName] = new Map(all[typeIsMemberOf][typeName].entries())
                        break
                    case 'enums':
                        used[typeIsMemberOf][typeName] = [...(all[typeIsMemberOf][typeName])]
                        break
                    default:
                        used[typeIsMemberOf][typeName] = { ...(all[typeIsMemberOf][typeName]) }
                }
                allUsed.add(typeName);
                for (const [k, v] of entries) addUsedMembers(v.type)
                return typeIsMemberOf
            }
        const entryIsMemberOf = addUsedMembers(entry), usedManifest = { ...this.types._base.Composite.manifest, entry, name, namespace, ...used }
        for (const [k, v] of Object.entries(unions)) if (enums[v.discriminant.type]) used.enums[v.discriminant.type] = [...enums[v.discriminant.type]]
        const typeClass = entryIsMemberOf === 'enums'
            ? createEnum(used.enums[entry], name, entry, namespace, usedManifest)
            : class extends this.types._base.Composite {
                static entry = entry
                static name = name
                static namespace = namespace
                static manifest = usedManifest
            }
        Object.defineProperty(typeClass.manifest, 'toJSON', { value: function () { return $this.manifestToJson(typeClass.manifest) } })
        return typeClass
    }, definitionURL = !xCode.includes(';') ? xCode : undefined, name = options?.name ?? entry
    let namespace = options?.namespace
    if (!namespace && (name in this.types._anon)) return this.types._anon[name]
    if (namespace && this.types[namespace] && (name in this.types[namespace])) return this.types[namespace][name]
    if (definitionURL) xCode = await (await fetch(new URL(definitionURL, document.baseURI).href)).text()
    let includesMatches = Array.from(xCode.matchAll(rx.includes))
    if (includesMatches.length) {
        const urlsFetched = {}, includes = options?.includes ?? this.options.includes, baseUri = options?.baseURI ?? definitionURL ?? document.baseURI
        while (includesMatches.length) {
            for (const includeMatch of includesMatches) {
                const includeURL = includes(includeMatch[0], baseUri)
                if (urlsFetched[includeURL]) {
                    xCode = xCode.replace(includeMatch[0], `\n\n`)
                } else {
                    if (!(includeURL in this._cache)) {
                        this._cache[includeURL] = (await (await fetch(includeURL)).text())
                        if (this.options.cacheExpiry) setTimeout(() => delete this._cache[includeURL], this.options.cacheExpiry)
                    }
                    xCode = xCode.replace(includeMatch[0], `\n\n${this._cache[includeURL]} \n\n`)
                    if (!this.options.cacheExpiry) delete this._cache[includeURL]
                }
                urlsFetched[includeURL] = true
            }
            includesMatches = Array.from(xCode.matchAll(rx.includes))
        }
    }
    const typeClass = parseX(xCode, entry, name)
    typeClass.namespace ??= namespace
    namespace ??= typeClass.namespace
    if (namespace) {
        if (namespace !== typeClass.namespace) typeClass.namespace = namespace
        typeClass.manifest.namespace = namespace
        this.types[namespace] ||= {}
        return this.types[namespace][name] = typeClass
    }
    return this.types._anon[name] = typeClass
}
export default factory