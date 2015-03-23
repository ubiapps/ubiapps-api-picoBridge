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

var _methods = {
  connect: "c",
  disconnect: "d",
  registerService: "r"
};

var _serviceCache = {};
var _dataCache = {};
var _pending
var _zeroBuf = new Buffer(1);
_zeroBuf[0] = 0;

function prepareMsg(obj) {
  var from = 	"toby@picosecHub.ubiapps.com";
  var to = 	"toby@picosecHub.ubiapps.com/te";
  var json = JSON.stringify(obj);
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
    msg.payload = JSON.parse(payload);
  } catch (e) {
    console.log("parseMessage - invalid JSON: " + payload + " error is: " + e.message);
  }

  return msg;
}

function requestTemp(sock) {
  var b = prepareMsg({ jsonrpc: "2.0", id: _msgId, method: "temp/room", params: { scale: 42, test: "hello world this is a long datagram" }});
  _requestTempId = _msgId;
  _msgId++;
  console.log("requesting temp");
  sock.write(b);
}

function receiveMessage(clientId,msg) {
  // Check message destination and forward if necessary.
  console.log("from " + msg.from + " to " + msg.to + " payload " + JSON.stringify(msg.payload));
  if (msg.payload.hasOwnProperty("id")) {
    if (msg.payload.hasOwnProperty("result")) {
      // This is a reply.
      if (msg.payload.id == _requestTempId) {
        var key = msg.from + "/temp/room";
        _dataCache[key] = msg.payload.result;
        _requestTempId = 0;
        setTimeout(function() { requestTemp(_clients[clientId]); }, 15000);
      }
    } else if (msg.payload.hasOwnProperty("method")) {
      // A method call.
      switch (msg.payload.method) {
        case _methods.connect:
          break;
        case _methods.registerService:
          var msg = {
            to: "toby@picosecHub.ubiapps.com",
            from: "toby@picosecHub.ubiapps.com/te",
            payload: {
              jsonrpc: "2.0",
              id: 123,
              method: "connect",
              params: {
                type: "led",
                instanceId: 1
              }
            }
          };
          if (!_serviceCache.hasOwnProperty(msg.from)) {
            _serviceCache[msg.from] = {};
          }
          var key = msg.payload.params.type+"/"+msg.payload.params.instanceId;
          _serviceCache[msg.from][key] = true;
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
}

function startPicoHub() {
  net.createServer(function(sock) {
    var clientId = _nextClientId++;
    _clientBuffer[clientId] = null;
    _clients[clientId] = sock;

    console.log('CONNECTED: ' + sock.remoteAddress +':'+ sock.remotePort);

    setTimeout(function() {
      console.log("initiating poll");
      requestTemp(sock);
      //setInterval(function() { requestTemp(sock); }, 15000);
    },5000);

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
      console.log('ERROR: ' + err.message);
    });

    // Add a 'close' event handler to this instance of socket
    sock.on('close', function(data) {
      console.log('CLOSED: ' + sock.remoteAddress +' '+ sock.remotePort);
    });

  }).listen(PORT, HOST);

  console.log('Server listening on ' + HOST +':'+ PORT);
}

function getServiceValue(deviceId,serviceType,serviceId) {
  var val = null;
  var key = deviceId + "/" + serviceType + "/" + serviceId;
  if (_dataCache.hasOwnProperty(key)) {
    val = _dataCache[key];
  }
  return val;
}

function notifyServiceCharge() {

}

module.exports.startHub = startPicoHub;
module.exports.getServiceValue = getServiceValue;
module.exports.notifyServiceChange = notifyServiceCharge;