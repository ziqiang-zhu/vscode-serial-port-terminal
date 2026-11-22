'use strict';

// 测试专用模块桩：经 `node --require ./test/mocks/install-vscode-stub.cjs` 预加载，
// 劫持 Module._load 把 'vscode' 重定向到最小测试替身（见 doc/Test/开发测试体系.md §5.2）。
// 仅实现 P0 单元测试所需成员；业务源码零改动。

const { EventEmitter: NodeEventEmitter } = require('node:events');
const Module = require('node:module');

class Disposable {
  constructor(callback) {
    this._callback = callback;
  }
  dispose() {
    if (typeof this._callback === 'function') {
      this._callback();
    }
  }
}

class EventEmitter {
  constructor() {
    this._emitter = new NodeEventEmitter();
  }
  // vscode.Event<T>：订阅返回 Disposable。
  get event() {
    return (listener) => {
      const wrapped = (data) => listener(data);
      this._emitter.on('event', wrapped);
      return new Disposable(() => this._emitter.off('event', wrapped));
    };
  }
  fire(data) {
    this._emitter.emit('event', data);
  }
  dispose() {
    this._emitter.removeAllListeners();
  }
}

const l10n = {
  // 仅实现 P0 用到的 {n} 占位符替换。
  t(message, ...args) {
    return String(message).replace(/\{(\d+)\}/g, (raw, index) => {
      const value = args[Number(index)];
      return value === undefined ? raw : String(value);
    });
  },
};

// 配置变更监听捕获（workspace.onDidChangeConfiguration 注册的 listener）。
const configurationChangeListeners = [];

const workspace = {
  _configuration: new Map(),
  getConfiguration() {
    return {
      get(key, defaultValue) {
        return workspace._configuration.has(key) ? workspace._configuration.get(key) : defaultValue;
      },
    };
  },
  // 配置监听捕获：A8 粒度用例经 __fireConfigurationChange(sections) 模拟一次变更，
  // listener 收到的事件以 affectsConfiguration(section) 按传入节名数组判定。
  onDidChangeConfiguration(listener) {
    configurationChangeListeners.push(listener);
    return new Disposable(() => {
      const index = configurationChangeListeners.indexOf(listener);
      if (index >= 0) {
        configurationChangeListeners.splice(index, 1);
      }
    });
  },
};

// 错误提示记录器：扫描失败去重用例经 __shownErrorMessages() 断言弹出次数。
const shownErrorMessages = [];

// 信息提示记录器：日志「文件已保存」提示用例经 __shownInfoMessages() 断言弹出次数。
const shownInfoMessages = [];

const window = {
  showErrorMessage(message) {
    shownErrorMessages.push(String(message));
  },
  showInformationMessage(message) {
    shownInfoMessages.push(String(message));
  },
};

const vscodeStub = {
  Disposable,
  EventEmitter,
  l10n,
  window,
  workspace,
  // 测试专用钩子（非 vscode API）：注入 workspace 配置值，undefined 表示清除。
  __setConfiguration(key, value) {
    if (value === undefined) {
      workspace._configuration.delete(key);
    } else {
      workspace._configuration.set(key, value);
    }
  },
  // 测试专用钩子（非 vscode API）：读取已记录的错误提示副本。
  __shownErrorMessages() {
    return [...shownErrorMessages];
  },
  // 测试专用钩子（非 vscode API）：读取已记录的信息提示副本。
  __shownInfoMessages() {
    return [...shownInfoMessages];
  },
  // 测试专用钩子（非 vscode API）：模拟一次配置变更——listener 的
  // affectsConfiguration(section) 按传入节名数组判定。
  __fireConfigurationChange(sections) {
    for (const listener of [...configurationChangeListeners]) {
      listener({ affectsConfiguration: section => sections.includes(section) });
    }
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};
