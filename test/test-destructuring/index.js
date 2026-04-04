import { getUser, getItems } from './data.js';

// Object destructuring — `age` is UNUSED (should be dead code)
const { name, age } = getUser();
console.log(name);

// Array destructuring — `third` is UNUSED (should be dead code)  
const [first, second, third] = getItems();
console.log(first, second);

// Nested destructuring — `zip` is UNUSED (should be dead code)
const { address: { city, zip } } = getUser();
console.log(city);

// Rest element — all USED
const { name: userName, ...rest } = getUser();
console.log(userName, rest);

// Default value destructuring — `fallback` is UNUSED (should be dead code)
const { missing: fallback = 'default' } = getUser();

// Regular unused variable (existing functionality) — should be dead code
const unusedRegular = 42;
