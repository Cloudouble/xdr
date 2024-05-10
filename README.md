# simple-xdr

A simple, fast and light-weight library for encoding and decoding XDR data within the browser or browser-like environments.

The .X syntax used as the standard has been taken from https://datatracker.ietf.org/doc/html/rfc4506.html

[Stellar](https://stellar.org/) specific features and syntax has been completed using the code from https://github.com/stellar/stellar-xdr/tree/curr as a guide and example.



## Install

```import XDR from "xdr.js"```



## Usage

    <script type="module">

        import XDR from "xdr.js"

        const fileBytes = new Uint8Array([
            0x00, 0x00, 0x00, 0x09,
            0x73, 0x69, 0x6c, 0x6c,
            0x79, 0x70, 0x72, 0x6f,
            0x67, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x02,
            0x00, 0x00, 0x00, 0x04,
            0x6c, 0x69, 0x73, 0x70,
            0x00, 0x00, 0x00, 0x04,
            0x6a, 0x6f, 0x68, 0x6e,
            0x00, 0x00, 0x00, 0x06,
            0x28, 0x71, 0x75, 0x69,
            0x74, 0x29, 0x00, 0x00
        ]),
            fileValue = {
                filename: "sillyprog",
                type: {
                    kind: "EXEC",
                    interpretor: "lisp"
                },
                owner: "john",
                data: [0x28, 0x71, 0x75, 0x69, 0x74, 0x29]
            },

            // load type definition from URL to any .X file or direct as a string of XDR type definition code 
            // as per the XDR: External Data Representation Standard 
            // at https://datatracker.ietf.org/doc/html/rfc4506.html
            // Note that type definition classes created with the `factory` method are cached once compiled
            // so remote files are only ever fetched once

            fileType = await XDR.factory('demo/file.X'),

            // create an instance of the type from a Uint8Array of byte integers 
            fileInstanceFromBytes = new fileType(fileBytes),

            // create an instance of the type from a live object that conforms to the type definition
            fileInstanceFromValue = new fileType(fileValue)

        console.log("From bytes: ", fileInstanceFromBytes)
        console.log("From value: ", fileInstanceFromValue)

        // serialize any conforming value to a Uint8Array of bytes
        console.log("Serialize: ", XDR.serialize(fileValue, fileType))

        // deserialize any Uint8Array of bytes to a live object that conforms to the type definition
        console.log("Deserialize: ", XDR.deserialize(fileBytes, fileType))

        // stringify any conforming value to a base64 string encoding the bytes
        const base64Str = XDR.stringify(fileValue, fileType)

        // parse any base64 string encoding of bytes to a live object that conforms to the type definition
        const parseResult = XDR.parse(base64Str, fileType)

        console.log("Base64 byte string: ", base64Str)

        console.log("Parsed to object: ", parseResult)

        console.log("JSON stringify: ", JSON.stringify(fileInstanceFromBytes))

    </script>



## API

### ```XDR.factory(xCode, entry, options)```

Creates, registers and returns a new type class from the given .X type definition. The type definition `xCode` can be a direct string of .X code, or it can be a URL to a .X file. 

The `entry` parameter is the name of a struct/union/typedef or enum definition contained within the .X file, while a single file can define many types, only one can be returned as the result of a factory call, this parameter allows the caller to specify which type to return.

For example: 

```
const TransactionEnvelope = await XDR.factory('https://raw.githubusercontent.com/stellar/stellar-xdr/curr/Stellar-transaction.x', 'TransactionEnvelope')

const Transaction = await XDR.factory('https://raw.githubusercontent.com/stellar/stellar-xdr/curr/Stellar-transaction.x', 'Transaction')

```

In the example above, the referenced .X file contains many type definitions, the `entry` parameter allows the caller to specify which type to return from the same file. If the same .X file is called more than once within a short time during application load, it is only requested once and cached for reuse by the library. 

The `options` object can contain the following properties, all of which are optional:

* **baseURI**: An absolute URL which will be used as the base for resolving included URLs within the .X file.
* **name**: the name for the returned class type
* **namespace**: a namespace to place the created class type within, will place the class as a value with a like-named sub-object within the `XDR.types` object, instead of directly within the `XDR.types` object
* **includes**: a function which can customize how includes statements within .X files are handled. The includes function is passed the string match and the baseURI and should return an absolute URL from which to fetch the included file. The built-in function is designed to handle the includes syntax as used by the Stellar type definitions. 

This function is idempotent, repeated calls with the same xCode argument will return the already compiled and cached type class.

### ```XDR.export(namespace = '_anon', format = 'xdr', raw = false)```

Returns a value which can be used to reconstruct all of the type classes that have been created using the `XDR.factory()` function. The optional `namespace` parameter will only return types that are within the given namespace, otherwise it will only return types that do not have any namespace.

The returned value can be saved as a .json or .xdr file and may be used to more efficiently load types in the future instead of parsing from .X files via the `factory` function.

The optional `format` parameter can be set to `'xdr'` or `'json'`, and will return the exported types in the given format. The default is `'xdr'`, which returns a string of XDR type definitions. The `'json'` format returns a JSON object.

The optional `raw` boolean parameter can be set to `true` to return a live native JavaScript plain object instead of a JSON string (when `format` is `'json'`), or an instance of a `TypeCollection` class (when `format` is `'xdr'`). The default is `false`, which returns a string to be saved and used later with `import()`.


### ```XDR.import(typeCollection, namespace, options = {}, format = undefined)```

Takes any value previously returned from a `XDR.export()` call and loads the given types directly into the XDR object ready for use. This bypasses the need to fetch and parse .X file and thus allows for far more efficient production loading of types. Many types can be loaded in one call, and no .X parsing is done with this function. While the loaded value may sometimes be actually slightly larger than the total size of the .X files that would have been parsed, this will give better performance when a large number of .X files would otherwise need to be loaded - using `import` allows for many types to be loaded from only one request.

The `types` argument may be any value previously returned from the `export` function, or a URL to a file with a JSON or XDR string as previously exported.

Each type exported/imported will have a key (normally the name of the type) that can be used to access it.

The optional `options` object can contain the same keys as the types being loaded, and each value is an options object used when loading that given type - with the same options available as the `options` argument to the `XDR.factory()`  function above. The object for each type can have an optional `namespace` property which will override the namespace that the type was exported from, as well as any global namespace defined for this import.

The optional `namespace` value can be set to import the types into a specific namespace, otherwise they will be loaded into the default namespace, or into the namespaces that they were exported from.

The optional `format` value can be set to `'xdr'` or `'json'`, and will load the given types in the given format. The default is `'xdr'`, which expects a string of XDR type definitions or a live `TypeCollection` instance. The `'json'` format expects a JSON object or JSON string. If omitted, the format will be inferred from the type of the `types` argument, including the URL extension if it is a URL.


### ```XDR.deserialize(bytes, typeDef, parameters = {}, raw=false)```

Deserialize a given byte array (as a `Uint8Array` instance) into a return JavaScript value, using the given the type definition class `typeDef` as the type. 

The optional `parameters` object can be used to trigger the deserialization as an array of instances of the given type, or (in the case of the core `opaque` or `string` types), to feed length and length mode values to the deserialization process. In both cases the valid properties for this object are `length` (the length or max length of the array/opaque/string), and `mode` (the default 'fixed' if the length is a fixed length, or 'variable' if the given length is the maximum length of a variable length array/opaque/string). If omitted `length` is `0` and `mode` is `'fixed'`.

For example: 

* Deserialize `bytes` as a variable length string with a maximum length of 15 characters: ```const myString = XDR.deserialize(bytes, XDR.types._core.string, {length: 15, mode: 'variable'})```, this would somewhat correspond to the .X syntax ```string myString<15>```. 
* A fixed length opaque type with a length of 16 bytes: ```const myOpaque = XDR.deserialize(bytes, XDR.types_core.opaque, {length: 16, mode: 'fixed'})```, this would somewhat correspond to the .X syntax ```opaque[16] myOpaque```.
* an array of `myType` instances with a fixed length of 10: ```const myArray = XDR.deserialize(bytes, XDR.types._anon.myType, {length: 10, mode: 'fixed'})```, this would somewhat correspond to the .X syntax ```myType myArray[10]```.
* an array of `myType` instances with a maximum length of 10: ```const myArray = XDR.deserialize(bytes, XDR.types._anon.myType, {length: 10, mode: 'variable'})```, this would somewhat correspond to the .X syntax ```myType myArray<10>```.

The final `raw` argument is set to `true` to return the instances of `typeDef` rather than the values of the instances. This is useful for when you want to use the instances of `typedef` as the basis for further serialization.


### ```XDR.serialize(value, typeDef, parameters = {})```

Serialize a given JavaScript value into a byte array, using the given the type definition class `typeDef` as the type. If the value is an array, it will be serialized as an array of instances of the given type, with the optional `length` and `mode` properties of the `parameters` argument being used. Specify the maximum length of the array if `parameters.mode` is 'fixed', or the maximum allowable length of the array if `parameters.mode` is 'variable'. If omitted, the serialization is done assuming the given value describes a single instance of the type. For the native types `XDR.types._core.opaque` and `XDR.types._core.string`, these two arguments describe the mode and length of the byte array or string.

Serialization as an array is assumed if the value is an array, and with the typeDef NOT being `XDR.types._core.opaque`. If the value is an array but `parameters.length` is omitted, the length of the given array `value` is used.


### ```XDR.parse(str, typeDef, parameters = {}, raw=false)```

Parse a given base64 encoded byte string into a live JavaScript value. The arguments and output are the same as `XDR.deserialize()`, except instead for a `Uint8Array` of bytes, it takes a base64 encoded string of bytes. 


### ```XDR.stringify(value, typeDef, parameters = {})```

Stringify a given live JavaScript value into a base64 encoded byte string of XDR formatted bytes. The arguments and output are the same as `XDR.serialize()`, except instead for a `Uint8Array` of bytes, it returns a base64 encoded string of bytes.


### ```XDR.types```

This object holds all currently loaded types as classes. They can be loaded one at a time from .X string or file URLS via the `XDR.factory()` method, or all at once using the `XDR.import()` method. The could also be manually constructed using the `XDR.types._base.TypeDef` or `XDR.types._base.BaseClass` classes as the base class and then directly added as values to any arbitary keys in this object. If a class has a namespace property defined, it will be found within a similarly-named sub-object of the `types` object.

Classes without a namespace specified will be placed within the `XDR.types._anon` sub-object as a quasi-namespace.


### ```XDR.options```

Can be used to defined default options for the `XDR.factory()` method. By default, it includes a default `includes` method. This can be overriden or other options as described above can have default value defined here as required.

The `cacheExpiry` option can be used to customize how long in milliseconds the libary should cache responses from retrieved .X files. The default is 10000 milliseconds (10 seconds).


### ```XDR.version```

Returns the current version of the SimpleXDR library.


## Built-in Types

The following types are built-in to the library, all within the `XDR.types._core` object:

* `XDR.types._core.int`: an integer type, may be signed or unsigned. For example `const one = new XDR.types._core.int(1)` or `const one = new XDR.types._core.int(new Uint8Array([0,0,0,1]))`. 
* `XDR.types._core.bool`: a boolean type: `const myFalse = new XDR.types._core.bool(false)`.
* `XDR.types._core.float`: a floating point type.
* `XDR.types._core.double`: a double precision floating point type.
* `XDR.types._core.hyper`: a 64-bit signed integer type.
* `XDR.types._core.opaque`: an opaque byte array type.
* `XDR.types._core.string`: a variable length string type.
* `XDR.types._core.void`: a void (null) type.

You may define a new complex type by extending the `XDR.types._base.BaseClass`, however it is recommended to create complex types using .X type definitions. 

In all cases, an instance of a type, can be serialized as the property formatted bytes via the `bytes` property, and parsed back into a live JavaScript value via the `value` property. They can be created using either a live JavaScript value of the correct type, or via a valid UInt8Array of bytes.

The core types generally behave as their values do as far as possible, for example `one + 1 = 2`. All types when converted to a string will render as a base64 encoded byte string, so \`${one}\` will render as `'AAAAAQ=='` rather then `'1'`.


## Base Classes

The following classes are extended to create the core types, compiled types by the `XDR.factory()` method, and can also be used to define new types manually. They are found within the `XDR.types._base` object:

* `XDR.types._base.Scalar`: a base type class which may be used to define other types with scalar data structures, similar to the core types. Keep in mind that types created by extending this manually will not be detected with the `XDR.factory()` method, you would also have to define your own parser or other custom usage.
* `XDR.types._base.Composite`: the base type which is used to define types with composite data structures, including all compiled types produced by `XDR.factory()`. Manually extending this is more likely to be useful, however it is still recommended to use .X type definitions and `XDR.factory()` to create new types.


## Recommended Type Definition and Development Process

It is recommended to use a folder of `.X` type definition files as per the `XDR: External Data Representation Standard` at https://datatracker.ietf.org/doc/html/rfc4506.html. These files can be loaded into the `XDR.types` object using the `XDR.factory()` method during development. This allows for an easily readable and editable type definition format which is already fast enough to enable rapid iterative development.

Once your type definitions are stable and complete, manually call the `XDR.export()` function to generate an XDR string which will contain the precompiled manifests of all types in the exported namespace. This string can then be saved to a file and loaded into the `XDR.types` object using the `XDR.import()` method for production usage.

You can also use the `XDR.export()` method to generate a JSON string - this is useful to manually introspect the manifests of the types in the exported namespace, but the XDR version will be more performant for actual usage.

Depending on the structure and complexity of your `.X` files, sometimes the `factory` method as recommended for development usage is actually faster and lighter than the `import` method for production usage. If every ounce of performance really matters, take the time to try both ways and compare which works best for your application.

Enjoy the world of XDR!
