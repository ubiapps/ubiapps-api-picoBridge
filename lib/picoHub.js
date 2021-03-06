var net = require('net');
var Buffers = require('buffers');

var PORT = 3000;
var HOST = '2001:470:6ceb::3';

var _nextClientId = 0;
var _clients = {};
var _clientBuffer = {};
var _sig = 0xbeef;
var _sigLen = 2;
var _lengthPrefixLen = 2;
var _headerLen = _sigLen + _lengthPrefixLen;
var _msgId = 0x0001;
var _requestTempId = 0;
var _requestLightId = 0;
var _subscribers = {};
var _serviceSubscribers = [];

var _methods = {
  register: "r"
};

var _dataCache = {};
var _pending;
var _zeroBuf = new Buffer(1);
_zeroBuf[0] = 0;

function prepareMsg(clientId, msg, cb) {
  if (typeof cb === "function") {
    _clients[clientId].callbacks[msg.id] = cb;
  }
  var from = 	"toby@picosecHub.ubiapps.com";
  var to = 	_clients[clientId].picoId;
  var json = JSON.stringify(msg);
  var len = json.length + from.length + 1 + to.length + 1;
  var buf = new Buffer(len + 4);
  buf.writeUInt16LE(_sig,0)
  buf.writeUInt16LE(len,2);
  buf.write(from,4);
  buf.writeUInt8(0,4+from.length);
  buf.write(to,4+from.length+1);
  buf.writeUInt8(0,4+from.length+1+to.length);
  buf.write(json,4+from.length+1+to.length+1);
  return buf;
}

function parseMessage(buffer) {
  var msg = {};

  var idx1 = _headerLen;
  var idx2 = buffer.indexOf(_zeroBuf,idx1);
  msg.from = buffer.toString("utf8",idx1,idx2);
  idx1 = idx2 + 1;
  idx2 = buffer.indexOf(_zeroBuf,idx1);
  msg.to = buffer.toString("utf8",idx1,idx2);
  var payload = buffer.toString("utf8",idx2 + 1);
  try {
    console.log("parsing payload: " + payload);
    msg.payload = JSON.parse(payload);
  } catch (e) {
    console.log("parseMessage - invalid JSON: " + payload + " error is: " + e.message);
  }

  return msg;
}

function sendMessage(clientId, buff) {
  _clients[clientId].socket.write(buff);
}

function requestServices(clientId) {
  if (_clients.hasOwnProperty(clientId)) {
    var buff = prepareMsg(clientId,{ jsonrpc: "2.0", id: _msgId, method: "services/get", params: { }}, receiveServices);
    _msgId++;
    console.log("requesting services");
    sendMessage(clientId,buff);
  }
}

function receiveServices(clientId, msg) {
  // Cache the services.
  _clients[clientId].picoId = msg.from;
  msg.payload.result.forEach(function(i) {
    serviceNotify(i.picoID, i.serviceType, i.serviceInstance);
    console.log("got service " + JSON.stringify(i) + " from " + msg.from);
  });

  setTimeout(function() {
    console.log("setting LED");
    LED(clientId, 0);
  },2500);

  setTimeout(function() {
    console.log("initiating temp poll");
    requestTemp(clientId);
  }, 5000);

  setTimeout(function() {
    console.log("initiating light poll");
    requestLight(clientId);
  }, 15000);
}

function LED(clientId, on) {
  if (_clients.hasOwnProperty(clientId)) {
    var msg = {jsonrpc: "2.0", id: _msgId, method: "LED/set", params: {LED: "red"}};
    msg.params.on = on ? 1 : 0;
    var buff = prepareMsg(clientId, msg, receiveLED);
    _msgId++;
    console.log("setting led");
    sendMessage(clientId, buff);
  }
}

function receiveLED(clientId, msg) {
  console.log("LED acknowledged: " + msg.payload.result);
  var key = msg.from + "/LED/LED";
  updateDataCache(key,{ on: msg.payload.result });
//  setTimeout(function() { LED(clientId,msg.payload.result == 1 ? false : true); }, 30000);
}

function requestTemp(clientId) {
  if (_clients.hasOwnProperty(clientId)) {
    var buff = prepareMsg(clientId, {jsonrpc: "2.0", id: _msgId, method: "temp/room/get", params: {}}, receiveTemp);
    _msgId++;
    console.log("requesting temp");
    sendMessage(clientId, buff);
  }
}

function receiveTemp(clientId, msg) {
  // This is a reply.
  var key = msg.from + "/sensor/temp/room";
  updateDataCache(key,msg.payload.result);
  setTimeout(function() { requestTemp(clientId); }, 60000);
}

function requestLight(clientId) {
  if (_clients.hasOwnProperty(clientId)) {
    var buff = prepareMsg(clientId, {jsonrpc: "2.0", id: _msgId, method: "light/room/get", params: {}}, receiveLight);
    _msgId++;
    console.log("requesting light");
    sendMessage(clientId, buff);
  }
}

function receiveLight(clientId, msg) {
  // This is a reply.
  var key = msg.from + "/sensor/light/room";
  updateDataCache(key,msg.payload.result);
  setTimeout(function() { requestLight(clientId); }, 15000);
}

function updateDataCache(key,data) {
  _dataCache[key] = data;
  if (_subscribers.hasOwnProperty(key)) {
    _subscribers[key].forEach(function(i) {
      i(data);
    });
  }
}

function removeClient(clientId) {
  console.log("removing client " + clientId);
  delete _clients[clientId];
  delete _clientBuffer[clientId];
}
function receiveMessage(clientId,msg) {
  // Check message destination and forward if necessary.
  console.log("from " + msg.from + " to " + msg.to + " payload " + JSON.stringify(msg.payload));
  try {
    if (msg.payload.hasOwnProperty("id")) {
      if (msg.payload.hasOwnProperty("result")) {
        if (_clients[clientId].callbacks.hasOwnProperty(msg.payload.id)) {
          _clients[clientId].callbacks[msg.payload.id](clientId, msg);
          delete _clients[clientId].callbacks[msg.payload.id];
        } else {
          console.log("no callback found for reply " + msg.payload.id);
        }
      } else if (msg.payload.hasOwnProperty("method")) {
        // A method call.
        switch (msg.payload.method) {
          case _methods.register:
            // ToDo - this needs to be part of the security handshake.
            _clients[clientId].picoId = msg.from;
            setTimeout(function() { requestServices(clientId); },5000);
            break;
          default:
            console.log("Ignoring unknown message " + msg.payload.method);
            break;

        }
      } else {
        // Has ID, but no method or result => Not valid JSONRPC
        console.log("receivedMessage - invalid JSONRPC");
      }
    } else if (msg.payload.hasOwnProperty("method")) {
      // No ID, but has method => this is a notification.
    } else {
      // Not valid JSONRPC
      console.log("receivedMessage - invalid JSONRPC");
    }
  } catch (e) {
    console.log("failed: " + e.message);
  }
}

function startPicoHub() {
  net.createServer(function(sock) {
    var clientId = _nextClientId++;
    _clientBuffer[clientId] = null;
    _clients[clientId] = { picoId: "", socket: sock, callbacks: {} };

    console.log("CONNECTED client " + clientId + " from " + sock.remoteAddress + ":" + sock.remotePort);

    setTimeout(function() { requestServices(clientId); },5000);

    // Add a 'data' event handler to this instance of socket
    sock.on('data', function(data) {
      if (_clientBuffer[clientId] === null) {
        _clientBuffer[clientId] = {data: Buffers()};
      }
      _clientBuffer[clientId].data.push(data);
      if (_clientBuffer[clientId].data.length > 1 && false === _clientBuffer[clientId].hasOwnProperty("sig")) {
        _clientBuffer[clientId].sig = _clientBuffer[clientId].data.get(0) + _clientBuffer[clientId].data.get(1)*256;
        if (_clientBuffer[clientId].sig !== _sig) {
          console.log("invalid signature 0x" + _clientBuffer[clientId].sig.toString(16));
        }
      }
      if (_clientBuffer[clientId].data.length > 3 && false === _clientBuffer[clientId].hasOwnProperty("requiredLength")) {
        _clientBuffer[clientId].requiredLength = _clientBuffer[clientId].data.get(2) + _clientBuffer[clientId].data.get(3)*256 + 4;
      }
      try {
        if (_clientBuffer[clientId].data.length == _clientBuffer[clientId].requiredLength) {
          var msg = parseMessage(_clientBuffer[clientId].data);
          receiveMessage(clientId,msg);
          _clientBuffer[clientId] = null;
        } else {
          //console.log("buffer length is: " + _clientBuffer[clientId].data.length + " want " + _clientBuffer[clientId].requiredLength);
        }
      } catch (e) {
        console.log("no parse - continuing");
      }
    });

    sock.on("error", function(err) {
      console.log("ERROR on client " + clientId + ", error is: " + err.message);
      removeClient(clientId);
    });

    // Add a 'close' event handler to this instance of socket
    sock.on('close', function(data) {
      console.log("CLOSED client " + clientId + ", socket address " + sock.remoteAddress + " " + sock.remotePort);
      removeClient(clientId);
    });

  }).listen(PORT, HOST);

  console.log('Server listening on ' + HOST +':'+ PORT);
}

function getServiceValue(serviceId) {
  var val = null;
  if (_dataCache.hasOwnProperty(serviceId)) {
    val = _dataCache[serviceId];
  }
  return val;
}

function setServiceValue(deviceId,serviceType,serviceId,val) {
  var key = deviceId + "/" + serviceType + "/" + serviceId + "/set";

  if (serviceType === "LED") {
    for (var clientId in _clients) {
      if (_clients.hasOwnProperty(clientId) && _clients[clientId].picoId == deviceId) {
        LED(clientId, val);
        break;
      }
    }
  }
  return val;
}

function subscribe(serviceId, cb) {
  if (!_subscribers.hasOwnProperty(serviceId)) {
    _subscribers[serviceId] = [];
  }
  _subscribers[serviceId].push(cb);
}

function subscribeService(cb) {
  _serviceSubscribers.push(cb);
}

function serviceNotify(device, serviceType, serviceInstance) {
  _serviceSubscribers.forEach(function(i) {
    i(device, serviceType, serviceInstance);
  });
}

module.exports.startHub = startPicoHub;
module.exports.getServiceValue = getServiceValue;
module.exports.setServiceValue = setServiceValue;
module.exports.subscribe = subscribe;
module.exports.subscribeService = subscribeService;