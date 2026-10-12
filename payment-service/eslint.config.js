const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['node_modules/', 'coverage/', 'openapi*.json'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    // Hexagonal dependency rule: the core depends on nothing outside itself.
    files: ['src/core/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='require'] > Literal[value=/^(express|knex|pg|swagger-jsdoc)$|adapters\\/|infrastructure\\//]",
          message: 'src/core must not depend on frameworks, adapters or infrastructure.',
        },
      ],
    },
  },
  prettier,
];
