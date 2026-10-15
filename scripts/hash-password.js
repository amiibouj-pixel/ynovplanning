'use strict';

// Usage : npm run hash-password            (saisie masquée)
//         npm run hash-password -- "motdepasse"
const bcrypt = require('bcryptjs');
const readline = require('readline');

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
      else rl.output.write('*');
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  const password = process.argv[2] || (await ask('Mot de passe admin : '));
  if (!password || password.length < 12) {
    console.error('Le mot de passe doit faire au moins 12 caractères.');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 12);
  console.log('\nAjoutez cette ligne dans votre fichier .env :\n');
  console.log("ADMIN_PASSWORD_HASH='" + hash + "'\n");
})();
