module.exports = {
  extends: ["eslint:recommended", "plugin:prettier/recommended"],
  plugins: ["header"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    sourceType: "module"
  },
  rules: {
    "header/header": [2, ".file-headerrc"]
  },
  env: {
    node: true
  }
};
