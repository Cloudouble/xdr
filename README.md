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

### ```XDR.factory(str, options)```

Creates, registers and returns a new type class from the given .X type definition. The type definition `str` can be a direct string of .X code, or it can be a URL to a .X file. The `options` object can contain the following properties, all of which are optional:

* **baseURI**: An absolute URL which will be used as the base for resolving included URLs within the .X file.
* **name**: the name for the returned class type
* **namespace**: a namespace to place the created class type within, will place the class as a value with a like-named sub-object within the `XDR.types` object, instead of directly within the `XDR.types` object
* **entry**: the name of a struct of union definition contained within the .X file, while a single file can define many types, only one can be returned as the result of a factory call, this option allows the caller to specify which type to return. If omitted, it will use the first found type that is not depended on by any other types in the file. 
* **includes**: a function which can customize how includes statements within .X files are handled. The includes function is passed the string match and the baseURI and should return an absolute URL from which to fetch the included file. The built-in function is designed to handle the includes syntax as used by the Stellar type definitions. 


### ```XDR.export(namespace)```

Returns an object with keys being type names and values being type manifest objects that can be used to reconstruct types using the `XDR.load()` function. The optional `namespace` parameter will only return types that are within the given namespace, otherwise it will only return types that do not have any namespace.

The returned value can be saved as a .json file and used to more efficiently load types in the future instead of parsing from .X files.


### ```XDR.load(types = {}, options = {}, defaultOptions = {})```

Takes an object previously returned from a `XDR.export()` call and loads the given types directly into the XDR object for use. This bypasses the need to fetch and parse .X file and thus allows for far more efficient production loading of types. Many types can be loaded in one call, and no .X parsing is done with this function. 

The `types` argument may also be a string, in which case it is resolved to a URL relative to the current module's base url, and then fetched and parsed as a JSON object.

The optional `options` object can contain the same keys as the types object, and each value is an options object used when loading that given type - with the same options available as the `options` argument to the `XDR.factory()`  function above.

The optional `defaultOptions` object can be used to create a template `options` object which will be used as the default options for all type loaded. The options in this object will be overridden on a per-option basis by the options in the `options` object.


### ```XDR.createEnum(body, name)```

Creates a new Enum class with the given body constants and name. The body arms is an array of strings which each correspond to the named constants within the enumeration, and their index within the array corresponds to the value of the constant. For example: 

The following enumeration with the name "colors" has 3 constants, RED, YELLOW, and BLUE, and their values are 2, 3, and 5 respectively: 
```enum { RED = 2, YELLOW = 3, BLUE = 5 } colors;```

Create a class to excapsulate this enumeration as follows: 

```const colorsEnumType = XDR.createEnum([,,'RED','YELLOW',,'BLUE'], 'colors')```

The built-in boolType class is created as follows: ```const boolType = createEnum([false, true], 'boolType')```


### ```XDR.deserialize(bytes, typeDef, arrayLength, arrayMode='fixed', raw=false)```

Deserialize a given byte array (as a `Uint8Array` instance) into a return JavaScript value, using the given the type definition class `typeDef` as the type. 

The deserialize the bytes as an array of instance of the given type, the optional `arrayLength` and `arrayMode` arguments are used. Specify the maximum length of the array if `arrayMode` is 'fixed', or the maximum allowable length of the array if `arrayMode` is 'variable'. If omitted, the deserialization is done assuming the given bytes describe a single instance of the type. The native types `XDR.types.opaque` and `XDR.types.string`, these two arguments describe the mode and length of the byte array or string.

For example: 

* Deserialize `bytes` as a variable length string with a maximum length of 15 characters: ```const myString = XDR.deserialize(bytes, XDR.types.string, 15, 'variable')```, this would somewhat correspond to the .X syntax ```string myString<15>```. 
* A fixed length opaque type with a length of 16 bytes: ```const myOpaque = XDR.deserialize(bytes, XDR.types.opaque, 16, 'fixed')```, this would somewhat correspond to the .X syntax ```opaque[16] myOpaque```.
* an array of `myType` instances with a fixed length of 10: ```const myArray = XDR.deserialize(bytes, XDR.types.myType, 10, 'fixed')```, this would somewhat correspond to the .X syntax ```myType myArray[10]```.
* an array of `myType` instances with a maximum length of 10: ```const myArray = XDR.deserialize(bytes, XDR.types.myType, 10, 'variable')```, this would somewhat correspond to the .X syntax ```myType myArray<10>```.

The final `raw` argument is set to `true` to return the instances of `typeDef` rather than the values of the instances. This is useful for when you want to use the instances of `typedef` as the basis for further serialization.


### ```XDR.serialize(value, typeDef, arrayLength, arrayMode='fixed')```

Serialize a given JavaScript value into a byte array, using the given the type definition class `typeDef` as the type. If the value is an array, it will be serialized as an array of instances of the given type, with the optional `arrayLength` and `arrayMode` arguments being used. Specify the maximum length of the array if `arrayMode` is 'fixed', or the maximum allowable length of the array if `arrayMode` is 'variable'. If omitted, the serialization is done assuming the given value describes a single instance of the type. For the native types `XDR.types.opaque` and `XDR.types.string`, these two arguments describe the mode and length of the byte array or string.

Serialization as an array is assumed if the value is an array, and with the typeDef NOT being `XDR.types.opaque`. If the value is an array but `arrayLength` is omitted, the length of the given array `value` is used.


### ```XDR.parse(str, typeDef, arrayLength, arrayMode, raw)```

Parse a given base64 encoded byte string into a live JavaScript value. The arguments and output are the same as `XDR.deserialize()`, except instead for a `Uint8Array` of bytes, it takes a base64 encoded string of bytes. 


### ```XDR.stringify(value, typeDef, arrayLength, arrayMode='fixed')```

Stringify a given live JavaScript value into a base64 encoded byte string of XDR formatted bytes. The arguments and output are the same as `XDR.serialize()`, except instead for a `Uint8Array` of bytes, it returns a base64 encoded string of bytes.


### ```XDR.types```

This object holds all currently loaded types as classes. They can be loaded one at a time from .X string or file URLS via the `XDR.factory()` method, or all at once using the `XDR.load()` method. The could also be manually constructed using the `XDR.types.TypeDef` class as the base class and then directly added as values to any arbitary keys in this object. If a class has a namespace property defined, it will be found within a similarly-named sub-object of the `types` object.


### ```XDR.options```

Can be used to defined default options for the `XDR.factory()` method. By default, it includes a default `includes` method. This can be overriden or other options as described above can have default value defined here as required.

