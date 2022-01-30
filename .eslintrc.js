module.exports = {
  extends: ["eslint:recommended", "plugin:prettier/recommended"],
  plugins: ["header"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    sourceType: "module"
  },
  rules: {
    "header/header": ["error", ".file-headerrc"],
    "no-useless-escape": "off",
    "no-unused-vars": [
      "error",
      // we are only using this rule to check for unused arguments since TS
      // catches unused variables but not args.
      { varsIgnorePattern: ".*", args: "none" }
    ]
  },
  env: {
    node: true
  }
};
