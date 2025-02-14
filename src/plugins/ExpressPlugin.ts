"use strict";
/*!
 *
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
Object.defineProperty(exports, "__esModule", { value: true });
var tslib_1 = require("tslib");
var ContextManager_1 = tslib_1.__importDefault(require("../trace/context/ContextManager"));
var Component_1 = require("../trace/Component");
var Tag_1 = tslib_1.__importDefault(require("../Tag"));
var ContextCarrier_1 = require("../trace/context/ContextCarrier");
var DummySpan_1 = tslib_1.__importDefault(require("../trace/span/DummySpan"));
var AgentConfig_1 = require("../config/AgentConfig");
var HttpPlugin_1 = tslib_1.__importDefault(require("./HttpPlugin"));
var ExpressPlugin = /** @class */ (function () {
    function ExpressPlugin() {
        this.module = 'express';
        this.versions = '*';
    }
    ExpressPlugin.prototype.install = function (installer) {
        this.interceptServerRequest(installer);
    };
    ExpressPlugin.prototype.interceptServerRequest = function (installer) {
        var _a, _b;
        var express = require('express');
        var router = express.Router ? express.Router() : require('express/lib/router');
        var _handle = router.handle;
        router.handle = function (req, res, next) {
            var _this = this;
            var _a;
            var carrier = ContextCarrier_1.ContextCarrier.from(req.headers || {});
            var reqMethod = (_a = req.method) !== null && _a !== void 0 ? _a : 'GET';
            var operation = reqMethod + ':' + (req.originalUrl || req.url || '/').replace(/\?.*/g, '');
            var span = AgentConfig_1.ignoreHttpMethodCheck(reqMethod)
                ? DummySpan_1.default.create()
                : ContextManager_1.default.current.newEntrySpan(operation, carrier, [Component_1.Component.HTTP_SERVER, Component_1.Component.EXPRESS]);
            span.component = Component_1.Component.EXPRESS;
            if (span.depth)
                // if we inherited from http then just change component ID and let http do the work
                return _handle.apply(this, arguments);
            return HttpPlugin_1.default.wrapHttpResponse(span, req, res, function () {
                // http plugin disabled, we use its mechanism anyway
                try {
                    return _handle.call(_this, req, res, function (err) {
                        span.error(err);
                        next.call(_this, err);
                    });
                }
                finally {
                    // req.protocol is only possibly available after call to _handle()
                    span.tag(Tag_1.default.httpURL((req.protocol ? req.protocol + '://' : '') + (req.headers.host || '') + req.url));
                }
            });
        };
    };
    return ExpressPlugin;
}());
// noinspection JSUnusedGlobalSymbols
exports.default = new ExpressPlugin();
//# sourceMappingURL=ExpressPlugin.js.map
