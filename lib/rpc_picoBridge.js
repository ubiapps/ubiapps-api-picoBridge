(function () {
  var RPCWebinosService = require('webinos-jsonrpc2').RPCWebinosService;
  var PicoBridgeImpl = require("./picoBridge_impl");

  var PicoBridgeModule = function (rpcHandler, params) {
    this.rpcHandler = rpcHandler;
    this.params = params;
    this.internalRegistry = {};
  };

  PicoBridgeModule.prototype.init = function (register, unregister) {
    this.register = register;
    this.unregister = unregister;
    process.nextTick(loadServices.bind(this));
  };

  var loadServices = function() {
    PicoBridgeImpl.loadServices(this.rpcHandler, this.register, this.unregister, PicoBridgeService);

    setTimeout(function() {
      var serviceParams = {
        deviceName: "toby@picosecHub.ubiapps.com/te",
        serviceType: "temp",
        serviceId: "room"
      };
      PicoBridgeImpl.addService(serviceParams);
    },35000);
  };

  PicoBridgeModule.prototype.updateServiceParams = function (serviceId, params) {
    var self = this;
    var id;

    if (serviceId && self.internalRegistry[serviceId]) {
      self.unregister({"id":serviceId, "api": self.internalRegistry[serviceId].api} );
      delete self.internalRegistry[serviceId];
    }

    if (params) {
      var service = new PicoBridgeService(this.rpcHandler, params);
      id = this.register(service);
      this.internalRegistry[id] = service;
    }

    return id;
  };

  var PicoBridgeService = function (rpcHandler, params) {
    // inherit from RPCWebinosService
    this.base = RPCWebinosService;
    this.base({
      api: 'http://ubiapps.com/api/picobridge/' + params.serviceType,
      displayName: params.deviceName + " " + params.serviceType + " " + params.serviceId,
      description: params.serviceType,
      serviceAddress: params.deviceName + "/" + params.serviceType + "/" + params.serviceId
    });

    this.rpcHandler = rpcHandler;

    this._impl = new PicoBridgeImpl(params, rpcHandler);
  };

  PicoBridgeService.prototype = new RPCWebinosService;

  PicoBridgeService.prototype.subscribe = function(params, successCB, errorCB, objectRef) {
    return this._impl.subscribe(successCB, errorCB, objectRef);
  };

  PicoBridgeService.prototype.unsubscribe = function(params, successCB, errorCB, objectRef) {
    return this._impl.unsubscribe(params[0], successCB, errorCB, objectRef);
  };

  PicoBridgeService.prototype.getCurrent = function (params, successCB, errorCB) {
    return this._impl.getCurrent(successCB, errorCB);
  };

  // export our object
  exports.Module = PicoBridgeModule;
})();
