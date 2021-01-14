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

export class Component {
  static readonly UNKNOWN = new Component(0);
  static readonly HTTP = new Component(2);
  static readonly MYSQL = new Component(5);
  static readonly MONGODB = new Component(9);
  static readonly GRPC = new Component(23);
  static readonly HTTP_SERVER = new Component(49);
  static readonly EXPRESS = new Component(4002);
  static readonly AXIOS = new Component(4005);

  constructor(public readonly id: number) { }
}
