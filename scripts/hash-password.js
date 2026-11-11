'use strict';

/**
 * Genera un hash bcrypt da usare in AUTH_USERS / AUTH_USERS_FILE.
 * Uso:  node scripts/hash-password.js "LaMiaPassword"
 *       docker run --rm ghcr.io/palmdomenico/amica-robots-form node scripts/hash-password.js "LaMiaPassword"
 */
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Uso: node scripts/hash-password.js "<password>"');
  process.exit(1);
}
console.log(bcrypt.hashSync(password, 12));
