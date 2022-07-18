# Compiling and Building

We use NodeJS 14 to build skywalking-nodejs project, if you don't have NodeJS 14 installed,
you can choose a node version manager like [nvm](https://github.com/nvm-sh/nvm) to easily
manage multiple node vesions, or you can start a Docker container and build this project inside
the container.

```shell
# Suppose you have the source codes in folder skywalking-nodejs
docker run -it --rm -v $(pwd)/skywalking-nodejs:/workspace -w /workspace node:14 bash
```

Then run the following commands to build the project:

```shell
npm install
npm run build
```

Warnings can be ignored, but if you have any error that prevents you to continue, try
`rm -rf node_modules/` and then rerun the commands above.
