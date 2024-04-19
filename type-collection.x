typedef string Name<>;

enum LengthMode {
    fixed = 0,
    variable = 1
};

struct Parameters {
    unsigned int *length;
    LengthMode *mode;
    bool *optional;
    bool *unsigned;
}

struct TypeParameters {
    Name type;
    Parameters params;
 };

struct PropertyParameters {
    Name type;
    Name identifier;
    Parameters params;
};

struct ArmParameters {
    Name type;
    Name arm;
    Name *identifier;
    Parameters params;
};

struct Discriminant {
    Name type;
    Name value;
};

struct EnumPair {
    unsigned int value;
    Name identifier;
};

struct EnumEntry {
    Name key;
    EnumPair body<>;
};

struct TypeDefEntry {
    Name key;
    TypeParameters declaration;
};

struct StructEntry {
    Name key;
    PropertyParameters properties<>;
};

struct UnionEntry {
    Name key;
    Discriminant discriminant;
    ArmParameters arms<>;
};

struct TypeLibrary {
    EnumEntry enums<>;
    StructEntry structs<>;
    TypeDefEntry typedefs<>;
    UnionEntry unions<>;
};

struct TypeManifest {
    Name entry;
    Name enums<>;
    Name name;
    Name structs<>;
    Name typedefs<>;
    Name unions<>;
};

struct TypeEntry {
    Name key;
    TypeManifest manifest;
};

struct TypeCollection {
    TypeLibrary library;
    TypeEntry types<>;
};