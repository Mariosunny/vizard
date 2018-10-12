import {forOwn, hasOwnProperty, isConstantValue, isEqual, isKeyValueObject} from "./util";
import {Errors} from "./errors";
import {$TYPE, $TEST, $NAME, $OPTIONAL, $CONSTRAINTS, $ELEMENT, $META, $UNIQUE, $RESERVED_KEYS, $ROOT} from "./keys";
import {string, list} from "./types";

function validateData(context, schema, data, errors, allowExtraneous, uniqueValues) {
    if(isConstantValue(schema) && !isEqual(schema, data)) {
        errors.invalidValue(context).value(data).add();
        findExtraneousProperties(context, schema, data, errors, allowExtraneous);
    }
    else {
        if(!passesTypeTest(schema, data)) {
            errors.invalidValue(context).value(data).expectedType(getTypeName(schema)).add();
            findExtraneousProperties(context, schema, data, errors, allowExtraneous);
        }

        if(hasOwnProperty(schema, $ELEMENT)) {
            validateArray(context, schema, data, errors, allowExtraneous, uniqueValues);
        }
        else {
            validateObject(context, schema, data, errors, allowExtraneous, uniqueValues);
        }
    }
}

function findExtraneousProperties(context, schema, data, errors, allowExtraneous) {
    if(!allowExtraneous && isKeyValueObject(data)) {
        forOwn(data, function(key) {
            if(!hasOwnProperty(schema, key)) {
                errors.extraneousProperty(addKeyToContext(context, key)).add();
            }
        });
    }
}

function validateArray(context, schema, data, errors, allowExtraneous, uniqueValues) {
    if(list.$test(data)) {
        let elementSchema = schema[$ELEMENT];

        data.forEach(function (element, i) {
            validateData(context + "[" + i + "]", elementSchema, element, errors, allowExtraneous, uniqueValues);
        });
    }
    else {
        errors.invalidValue(context).value(data).expectedType(list.$name).add();
    }
}

function validateObject(context, schema, data, errors, allowExtraneous, uniqueValues) {
    checkUniqueness(context, schema, data, errors, uniqueValues);

    forOwnNonReservedProperty(schema, function(key, value) {
        let newContext = context + (context.length === 0 ? "": ".")  + key;
        let newSchema = value;
        let dataHasProperty = hasOwnProperty(data, key);
        let newData = data[key];

        if(!isOptional(newSchema) && !dataHasProperty) {
            errors.missingProperty(newContext).add();
        }
        else if(dataHasProperty){
            validateData(newContext, newSchema, newData, errors, allowExtraneous, uniqueValues);
        }
    });
}

function checkUniqueness(context, schema, data, errors, uniqueValues) {
    let uniqueContext = getUniqueContext(context, uniqueValues);

    if(uniqueContext) {
        let localUniqueValues = uniqueValues[uniqueContext];

        for(let i = 0; i < localUniqueValues.length; i++) {
            if(isEqual(localUniqueValues[i], data)) {
                errors.duplicateValue(context).value(data).add();
                return;
            }
        }

        localUniqueValues.push(data);
    }
}

function getUniqueContext(context, uniqueValues) {
    if(context === "") {
        context = $ROOT;
    }
    else {
        context = context.replace(/\[[0-9]+\]/, "[x]");
    }

    if(uniqueValues.hasOwnProperty(context)) {
        return context;
    }

    return null;
}

function isOptional(schema) {
    if(schema[$OPTIONAL]) {
        return true;
    }
    else if(hasOwnProperty(schema, $TYPE)) {
        return isOptional(schema[$TYPE]);
    }

    return false;
}

function forOwnNonConstraintProperty(schema, func) {
    return forOwn(schema, func, key => !$CONSTRAINTS.includes(key));
}

function forOwnNonReservedProperty(schema, func) {
    return forOwn(schema, func, key => !$RESERVED_KEYS.includes(key));
}

function passesTypeTest(schema, data) {
    let result = true;

    if(schema.hasOwnProperty($ELEMENT) && !schema.hasOwnProperty($TYPE)) {
        result = list.$test(data);
    }

    if(schema.hasOwnProperty($TYPE) && isKeyValueObject(schema[$TYPE])) {
        result = passesTypeTest(schema[$TYPE], data) && result;
    }

    if(result && schema.hasOwnProperty($TEST)) {
        let test = schema[$TEST];

        if(test instanceof RegExp) {
            result = result && string.$test(data) && test.test(data);
        }
        else if(typeof test === 'function') {
            result = result && test(data);
        }
    }

    return result;
}

function getTypeName(schema) {
    let name = null;

    if (schema[$NAME]) {
        name = schema[$NAME];
    }
    else if (schema[$TEST] && !schema[$TYPE] && schema[$TEST] instanceof RegExp) {
        name = schema[$TEST];
    }
    else if (schema[$TYPE] && isKeyValueObject(schema[$TYPE])) {
        name = getTypeName(schema[$TYPE]);
    }

    return name;
}

function addKeyToContext(context, key) {
    return context + (context.length === 0 ? "": ".") + key;
}

function addElementToContext(context, index) {
    return context + "[" + index + "]";
}

function addMeta(schema) {
    if(!schema.hasOwnProperty($META)) {
        schema[$META] = {
            uniqueValues: {}
        };
        schema[$META].reset = function() {
            forOwn(schema[$META].uniqueValues, function(context) {
                schema[$META].uniqueValues[context] = [];
            });
        };

        initializeUniqueValues("", schema, schema[$META].uniqueValues);
    }
}

function initializeUniqueValues(context, schema, uniqueValues) {
    if(isConstantValue(schema)) {
        return;
    }
    if(schema[$UNIQUE]) {
        uniqueValues[context.length === 0 ? $ROOT: context] = [];
    }
    else {
        forOwnNonConstraintProperty(schema, function(key, value) {
            if(key === $ELEMENT) {
                initializeUniqueValues(addElementToContext(context, 'x'), value, uniqueValues);
            }
            else {
                initializeUniqueValues(addKeyToContext(context, key), value, uniqueValues);
            }
        });
    }
}

export function verify(schema, data, allowExtraneous = false) {
    return validate(schema, data, allowExtraneous).length === 0;
}

export function validate(schema, data, allowExtraneous = false) {
    let errors = new Errors();

    addMeta(schema);

    let meta = schema[$META];
    schema[$META] = undefined;
    validateData("", schema, data, errors, allowExtraneous, meta.uniqueValues);
    schema[$META] = meta;

    return errors.errors;
}