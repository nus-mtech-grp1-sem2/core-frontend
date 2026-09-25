// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      // Attribute selectors are allowed for components: `li[app-event-card]` keeps
      // the list markup valid.
      '@angular-eslint/component-selector': [
        'error',
        {
          type: ['element', 'attribute'],
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
      // Repository conventions (AGENTS.md): OnPush everywhere.
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      // Repository conventions (AGENTS.md): class bindings instead of ngClass.
      // `prefer-ngsrc` is deliberately not enabled: NgOptimizedImage is reserved for bundled
      // static images, while event artwork from the API and blob/data-URL previews cannot use
      // it, and the rule cannot tell the two apart. Reviewers enforce it for static images.
      '@angular-eslint/template/prefer-class-binding': 'error',
    },
  },
]);
