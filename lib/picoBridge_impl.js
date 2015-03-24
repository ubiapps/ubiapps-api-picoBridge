(function() {
  "use strict";
  var http = require("http");
  var url = require("url");
  var fs = require("fs");
  var path = require("path");
  var pzpAPI = require(path.join(require.main.paths[0], "..", "lib", "pzp_sessionHandling.js"));
  var picoHub = require("./picoHub.js");

  function PicoBridgeImpl(cfg,rpcHandler) {
    this._rpcHandler = rpcHandler;
    this._config = cfg;
    this._subscribers = {};
    this._pollTimer = 0;
    this._pollInterval = 30000;
    this._cachedCurrent = undefined;

    picoHub.subscribe(cfg.deviceName, cfg.serviceType, cfg.serviceId, onData.bind(this));
  }

  var onData = function(data) {
    this._cachedCurrent = data;
    for (var s in this._subscribers) {
      if (this._subscribers.hasOwnProperty(s)) {
        var objectRef = this._subscribers[s];
        notifySubscriber.call(this,objectRef);
      }
    }
  };

  var getCurrent = function(successCB, errorCB) {
    var cached = picoHub.getServiceValue(this._config.deviceName, this._config.serviceType, this._config.serviceId);
    successCB(cached);
  };

  var notifySubscriber = function(objectRef) {
    var rpc = this._rpcHandler.createRPC(objectRef, 'onEvent', this._cachedCurrent);
    if (false === this._rpcHandler.executeRPC(rpc)) {
      // Client dropped?
      console.log("************ uControl - deleting dropped subscriber");
      delete this._subscribers[objectRef.rpcId];
    }
  };

  var doPoll = function() {
    var self = this;
    var oldCache = JSON.stringify(self._cachedCurrent);
    self._pollTimer = 0;

    var success = function(val) {
      if (JSON.stringify(val) !== oldCache) {
        for (var s in self._subscribers) {
          if (self._subscribers.hasOwnProperty(s)) {
            var objectRef = self._subscribers[s];
            notifySubscriber.call(self,objectRef);
          }
        }
      }
      startPolling.call(self);
    };

    var err = function(err) {
      console.log("failed during ucontrol service call");
      startPolling.call(self);
    };

    getCurrent.call(self,success,err);
  };

  var startPolling = function() {
    if (this._pollTimer === 0 && Object.keys(this._subscribers).length > 0) {
      this._pollTimer = setTimeout(doPoll.bind(this),this._pollInterval);
    }
  };

  PicoBridgeImpl.prototype.subscribe = function(successCB, errorCB, objectRef) {
    var self = this;

    // Add callbacks to list of subscribers.
    if (!this._subscribers.hasOwnProperty(objectRef.rpcId)) {
      this._subscribers[objectRef.rpcId] = objectRef;
      if (this._cachedCurrent === undefined) {
        getCurrent.call(this, function(val) { process.nextTick(function() { notifySubscriber.call(self,objectRef); }, errorCB);
        });
      } else {
        process.nextTick(function() { notifySubscriber.call(self,objectRef); });
      }
    }

    startPolling.call(this);
  };

  PicoBridgeImpl.prototype.unsubscribe = function(id, successCB, errorCB) {
    // Remove callbacks from list of subscribers.
    delete this._subscribers[id];
    successCB();
  };

  PicoBridgeImpl.prototype.getCurrent = function(successCB, errorCB) {
    getCurrent.call(this,successCB,errorCB);
  };

  PicoBridgeImpl.loadServices = function(rpcHandler, register, unregister, serviceClass) {
    var serviceParams = {
      deviceName: "toby@picosecHub.ubiapps.com/te",
      serviceType: "light",
      serviceId: "room"
    };

    var service = new serviceClass(rpcHandler, serviceParams);
    var id = register(service);

    setTimeout(picoHub.startHub, 5000);
  };

  PicoBridgeImpl.addService = function(params, successCB, errorCB) {
    var configFilePath = path.join(pzpAPI.getWebinosPath(), "userData", "ubiapps-api-picoBridge", "config.json");
    var currentConfig = JSON.parse(fs.readFileSync(configFilePath)).params.instances;
    var found = false;
    for (var cfg in currentConfig) {
      if (currentConfig[cfg].params.serviceId === params.serviceId) {
        console.log("ignoring new pico service as already exists: " + params.serviceId);
        found = true;
        break;
      }
    }
    if (!found) {
      var lst = currentConfig.concat([ { params: params }]);
      pzpAPI.setServiceConfiguration(null, "http://ubiapps.com/api/picobridge", lst);
      if (successCB) {
        successCB();
      }
    } else {
      if (errorCB) {
        errorCB(new Error("service already exists '" + params.serviceId + "'"));
      }
    }
  };

  module.exports = PicoBridgeImpl;
}());