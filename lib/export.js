const _export = async function (namespace = '_anon', format = 'xdr', raw = false) {
    const source = this.types[namespace ?? '_anon'], typeManifests = {}
    format = format === 'json' ? 'json' : 'xdr'
    for (const [k, v] of Object.entries(source)) if (v.manifest && v.manifest instanceof Object) typeManifests[k] = JSON.parse(JSON.stringify(v.manifest))
    const typeCollection = { library: { enums: [], structs: [], typedefs: [], unions: [] }, types: [] }, usedKeys = new Set()
    for (const name in typeManifests) {
        const manifest = { ...typeManifests[name] }
        for (const key in manifest.enums) {
            if (usedKeys.has(key)) continue
            typeCollection.library.enums.push({
                key, body: manifest.enums[key].map((identifier, value) => identifier ? { value, identifier } : null).filter(n => n)
            })
            usedKeys.add(key)
        }
        for (const key in manifest.structs) {
            if (usedKeys.has(key)) continue
            const properties = []
            for (const property of manifest.structs[key]) properties.push({ ...property[1], identifier: property[0] })
            typeCollection.library.structs.push({ key, properties })
            usedKeys.add(key)
        }
        for (const key in manifest.typedefs) {
            if (usedKeys.has(key)) continue
            typeCollection.library.typedefs.push({ key, declaration: manifest.typedefs[key] })
            usedKeys.add(key)
        }
        for (const key in manifest.unions) {
            if (usedKeys.has(key)) continue
            const discriminant = { ...manifest.unions[key].discriminant }, arms = []
            for (const arm in manifest.unions[key].arms) arms.push(manifest.unions[key].arms[arm])
            typeCollection.library.unions.push({ key, discriminant, arms })
            usedKeys.add(key)
        }
        for (const scope in typeCollection.library) manifest[scope] = Object.keys(manifest[scope])
        typeCollection.types.push({ key: name, manifest })
    }
    if (format === 'json') return raw ? typeCollection : JSON.stringify(typeCollection)
    if (!this.types._base.TypeCollection) await this.createTypeCollection()
    const typeCollectionInstance = new this.types._base.TypeCollection(typeCollection)
    return raw ? typeCollectionInstance : `${typeCollectionInstance}`
}

export default _export