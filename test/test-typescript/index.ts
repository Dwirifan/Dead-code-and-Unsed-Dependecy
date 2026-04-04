import { greet } from './helper.ts';

// TypeScript types should not cause parse errors
interface User {
    name: string;
    age: number;
}

// Used variable
const user: User = { name: 'Alice', age: 30 };
console.log(greet(user.name));

// UNUSED variable — should be dead code
const unusedTyped: number = 100;

// UNUSED function — should be dead code
function unusedHelper(x: string): string {
    return x.toUpperCase();
}
