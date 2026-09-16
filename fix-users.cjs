const fs = require('fs');

let path = 'worker/src/data/registration-invites.ts';
let content = fs.readFileSync(path, 'utf8');

// Update CreateUserWithInviteInput
content = content.replace(
  /export interface CreateUserWithInviteInput \{/,
  `export interface CreateUserWithInviteInput {\n  email?: string;`
);

// Update insert statement
content = content.replace(
  /INSERT INTO users \(\n\s*username,\n\s*display_name,\n\s*password_hash,\n\s*password_salt\n\s*\) VALUES \(\?, \?, \?, \?\)/,
  `INSERT INTO users (
           username,
           email,
           display_name,
           password_hash,
           password_salt
         ) VALUES (?, ?, ?, ?, ?)`
);

// Update binds
content = content.replace(
  /\)\.bind\(user\.username, user\.displayName, user\.passwordHash, user\.passwordSalt\),/,
  `).bind(user.username, user.email || null, user.displayName, user.passwordHash, user.passwordSalt),`
);

fs.writeFileSync(path, content, 'utf8');

// Add generic open registration
let authPath = 'worker/src/api/auth.ts';
// Actually wait, auth endpoints are in `index.ts`!
// Let's modify index.ts directly.
let indexContent = fs.readFileSync('worker/src/index.ts', 'utf8');
indexContent = indexContent.replace(
  /import \{ getUserByUsername, listActiveUsers \} from '\.\/data\/users\.ts';/,
  `import { getUserByUsername, listActiveUsers } from './data/users.ts';\nimport { createOpenUser, createPasswordReset, getPasswordReset, clearPasswordReset, resetUserPassword } from './data/auth.ts';`
);

fs.writeFileSync('worker/src/index.ts', indexContent, 'utf8');

console.log('updated users & register files');
