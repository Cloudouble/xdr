function typeCollectionFactory() {
    const { parameters, unsignedParameters, optionalParameters } = this.parametersCollection
    return class TypeCollection extends this.types._base.BaseClass {
        static entry = 'TypeCollection'
        static name = 'TypeCollection'
        static namespace = '_core'
        static manifest = {
            entry: 'TypeCollection', name: 'TypeCollection',
            structs: {
                TypeCollection: new Map([['library', { type: 'TypeLibrary' }], ['types', { type: 'TypeEntry', parameters }]]),
                TypeLibrary: new Map([['enums', { type: 'EnumEntry', parameters }], ['structs', { type: 'StructEntry', parameters }], ['typedefs', { type: 'TypeDefEntry', parameters }], ['unions', { type: 'UnionEntry', parameters }]]),
                EnumEntry: new Map([['key', { type: 'Name' }], ['body', { type: 'EnumPair', parameters }]]),
                EnumPair: new Map([['value', { type: 'int', parameters: unsignedParameters }], ['identifier', { type: 'Name' }]]),
                StructEntry: new Map([['key', { type: 'Name' }], ['properties', { type: 'PropertyParameters', parameters }]]),
                PropertyParameters: new Map([['type', { type: 'Name' }], ['identifier', { type: 'Name' }], ['parameters', { type: 'Parameters', parameters: optionalParameters }]]),
                Parameters: new Map([['length', { type: 'int', parameters: unsignedParameters }], ['mode', { type: 'LengthMode' }], ['optional', { type: 'bool' }], ['unsigned', { type: 'bool' }]]),
                TypeDefEntry: new Map([['key', { type: 'Name' }], ['declaration', { type: 'TypeParameters' }]]),
                TypeParameters: new Map([['type', { type: 'Name', }], ['parameters', { type: 'Parameters', parameters: optionalParameters }]]),
                UnionEntry: new Map([['key', { type: 'Name' }], ['discriminant', { type: 'Discriminant' }], ['arms', { type: 'ArmParameters', parameters }]]),
                Discriminant: new Map([['type', { type: 'Name' }], ['identifier', { type: 'Name' }]]),
                ArmParameters: new Map([['type', { type: 'Name' }], ['arm', { type: 'Name' }], ['identifier', { type: 'Name', parameters: optionalParameters }], ['parameters', { type: 'Parameters', parameters: optionalParameters }]]),
                TypeEntry: new Map([['key', { type: 'Name' }], ['manifest', { type: 'TypeManifest' }]]),
                TypeManifest: new Map([['entry', { type: 'Name' }], ['enums', { type: 'Name', parameters }], ['name', { type: 'Name' }], ['structs', { type: 'Name', parameters }], ['typedefs', { type: 'Name', parameters }], ['unions', { type: 'Name', parameters }]])
            },
            unions: {},
            typedefs: { Name: { type: 'string', parameters } },
            enums: { LengthMode: ['fixed', 'variable'] }
        }
    }
}
export default typeCollectionFactory