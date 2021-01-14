import { CallOptions, Metadata, ServiceDefinition } from "@grpc/grpc-js";
import { SpanLayer } from "../proto/language-agent/Tracing_pb";
import { Component } from "../trace/Component";
import SwPlugin from "../core/SwPlugin";
import ContextManager from "../trace/context/ContextManager";
import Tag from "../Tag";
import { ServerSurfaceCall } from "@grpc/grpc-js/build/src/server-call";
import { ContextCarrier } from "../trace/context/ContextCarrier";
import PluginInstaller from "../core/PluginInstaller";

class GrpcPlugin implements SwPlugin {
  readonly module = '@grpc/grpc-js';
  readonly versions = '*';

  install(installer: PluginInstaller): void {
    this.interceptClientMakeUnaryRequest(installer);
    this.interceptServerCall(installer);
  }

  private interceptClientMakeUnaryRequest(installer: PluginInstaller) {
    const grpc = installer.require("@grpc/grpc-js")
    Object.defineProperty(grpc, "makeClientConstructor", {
      value: function (methods: ServiceDefinition,
        serviceName: string,
        classOptions?: {}) {
        const requesterFuncs = {
          unary: grpc.Client.prototype.makeUnaryRequest,
          server_stream: grpc.Client.prototype.makeServerStreamRequest,
          client_stream: grpc.Client.prototype.makeClientStreamRequest,
          bidi: grpc.Client.prototype.makeBidiStreamRequest,
        };
        function partial(fn: Function,
          path: string,
          serialize: Function,
          deserialize: Function) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return function (this: any, argument: any, metadata: Metadata, options: CallOptions, callback: any) {
            const checkedArguments = this.checkOptionalUnaryResponseArguments(metadata, options, callback);
            var span = ContextManager.current.newExitSpan(path, this.getChannel().getTarget()).start();
            span.component = Component.GRPC;
            span.layer = SpanLayer.RPCFRAMEWORK;
            span.tag(Tag.GrpcArgument(JSON.stringify(argument)));
            span.inject().items.forEach(item => {
              checkedArguments.metadata.set(item.key, item.value);
            })
            span.async();
            const emitter = fn.call(this, path, serialize, deserialize, argument, checkedArguments.metadata, checkedArguments.options, checkedArguments.callback);
            emitter.on("status", function () {
              span.resync();
              span.stop();
            });
            return emitter;
          };
        }
        if (!classOptions) {
          classOptions = {};
        }
        class ServiceClientImpl extends grpc.Client {
        }

        Object.keys(methods).forEach((name) => {
          if (name === '__proto__') {
            return;
          }
          const attrs = methods[name];
          let methodType: keyof typeof requesterFuncs;
          // TODO(murgatroid99): Verify that we don't need this anymore
          if (typeof name === 'string' && name.charAt(0) === '$') {
            throw new Error('Method names cannot start with $');
          }
          if (attrs.requestStream) {
            if (attrs.responseStream) {
              methodType = 'bidi';
            } else {
              methodType = 'client_stream';
            }
          } else {
            if (attrs.responseStream) {
              methodType = 'server_stream';
            } else {
              methodType = 'unary';
            }
          }
          const serialize = attrs.requestSerialize;
          const deserialize = attrs.responseDeserialize;
          const methodFunc = partial(
            requesterFuncs[methodType],
            attrs.path,
            serialize,
            deserialize
          );
          ServiceClientImpl.prototype[name] = methodFunc;
          // Associate all provided attributes with the method
          Object.assign(ServiceClientImpl.prototype[name], attrs);
          if (attrs.originalName && attrs.originalName !== '__proto__') {
            ServiceClientImpl.prototype[attrs.originalName] =
              ServiceClientImpl.prototype[name];
          }
        });

        ServiceClientImpl.service = methods;

        return ServiceClientImpl;
      }
    })
  }

  private interceptServerCall(installer: PluginInstaller) {
    const call = installer.require("@grpc/grpc-js/build/src/server-call")
    const Http2ServerCallStream = call.Http2ServerCallStream;
    // this method called by handleUnary/handleClientStreaming/handleServerStreaming/handleBidiStreaming when create emitter or stream
    const setupSurfaceCall: Function = Http2ServerCallStream.prototype.setupSurfaceCall;
    Http2ServerCallStream.prototype.setupSurfaceCall = function (call: ServerSurfaceCall) {
      const metadata = call.metadata.getMap();
      const headersMap: { [key: string]: string } = {};
      for (const key in metadata) {
        headersMap[key] = metadata[key].toString();
      }
      const carrier = ContextCarrier.from(headersMap);
      const span = ContextManager.current.newEntrySpan(this.handler.path, carrier).start();
      span.component = Component.GRPC;
      span.layer = SpanLayer.RPCFRAMEWORK;
      const socket = this.stream.session.socket;
      let remoteAddress = "";
      if (socket.remoteAddress) {
        if (socket.remotePort) {
          remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
        } else {
          remoteAddress = socket.remoteAddress;
        }
      }
      span.peer = remoteAddress;
      setupSurfaceCall.apply(this, [call]);
    }
    const sendUnaryMessage: Function = Http2ServerCallStream.prototype.sendUnaryMessage;
    Http2ServerCallStream.prototype.sendUnaryMessage = function () {
      ContextManager.spans[0].stop();
      sendUnaryMessage.apply(this, arguments);
    }

  }
}

export default new GrpcPlugin();
