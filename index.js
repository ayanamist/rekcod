'use strict'

const child_process = require("child_process")

module.exports = function (containers, cb) {
  let cbCalled = false
  let stdout = [], stderr = []
  let child = child_process.spawn('docker', ['inspect'].concat(containers))
  child.stderr.on('data', (data) => {
    stderr.push(data)
  })
  child.stdout.on('data', (data) => {
    stdout.push(data)
  })
  child.on('error', (err) => {
    if (!cbCalled) {
      cbCalled = true
      cb(err)
    }
  })
  child.on('close', (code, signal) => {
    if (cbCalled) return
    if (code !== 0) {
      let err = new Error('docker inspect failed with code ' + code + ' from signal ' + signal)
      err.code = code
      err.signal = signal
      if (stderr.length) err.stderr = stderr.join('')
      if (stdout.length) err.stdout = stdout.join('')
      cbCalled = true
      return cb(err)
    }
    processJson(stdout.join(''), cb)
  })
}

function processJson (json, cb) {
  let array
  try {
    array = JSON.parse(json)
  } catch (err) {
    return cb(err)
  }
  if (!Array.isArray(array) || !array.length) {
    return cb(new Error('Unexpected output: ' + array))
  }
  let runObjects = []
  array.forEach((inspectObj) => {
    addRunObject(runObjects, inspectObj)
  })
  cb(null, runObjects)
}

function addRunObject (runObjects, inspectObj) {
  let run = {}

  run.image = shortHash(inspectObj.Image)
  run.id = shortHash(inspectObj.Id)

  run.name = inspectObj.Name
  if (run.name && run.name.indexOf('/') === 0) run.name = run.name.substring(1)

  run.command = toRunCommand(inspectObj, run.name)

  runObjects.push(run)
}

function shortHash (hash) {
  if (hash && hash.length && hash.length > 12) return hash.substring(0, 12)
  return hash
}

function toRunCommand (inspectObj, name) {
  let rc = 'docker run -d'
  rc = append(rc, '--name', name)

  let hostcfg = inspectObj.HostConfig || {}
  rc = appendArray(rc, '-v', hostcfg.Binds)
  if (hostcfg.PortBindings) {
    rc = appendObjectKeys(rc, '-p', hostcfg.PortBindings, (ipPort) => {
      return ipPort.HostIp ? ipPort.HostIp + ':' + ipPort.HostPort : ipPort.HostPort
    })
  }
  rc = appendArray(rc, '--link', hostcfg.Links, (link) => {
    link = link.split(':')
    if (link[0] && ~link[0].lastIndexOf('/')) link[0] = link[0].substring(link[0].lastIndexOf('/') + 1)
    if (link[1] && ~link[1].lastIndexOf('/')) link[1] = link[1].substring(link[1].lastIndexOf('/') + 1)
    return link[0] + ':' + link[1]
  })
  if (hostcfg.PublishAllPorts) rc = rc + ' -P'
  if (hostcfg.NetworkMode && hostcfg.NetworkMode !== 'default') {
    rc = append(rc, '--net', hostcfg.NetworkMode)
  }
  if (hostcfg.RestartPolicy && hostcfg.RestartPolicy.Name) {
    rc = append(rc, '--restart', hostcfg.RestartPolicy, (policy) => {
      return policy.Name === 'on-failure' ? policy.Name + ':' + policy.MaximumRetryCount : policy.Name
    })
  }

  let cfg = inspectObj.Config || {}
  if (cfg.Hostname) rc = append(rc, '-h', cfg.Hostname)
  if (cfg.ExposedPorts) {
    rc = appendObjectKeys(rc, '--expose', cfg.ExposedPorts)
  }
  rc = appendArray(rc, '-e', cfg.Env, (env) => {
    return /\s/g.test(env) ? '"' + env + '"' : env
  })
  if (cfg.Entrypoint) rc = appendJoinedArray(rc, '--entrypoint', cfg.Entrypoint, ' ')

  rc = rc + ' ' + (cfg.Image || inspectObj.Image)

  if (cfg.Cmd) rc = appendJoinedArray(rc, null, cfg.Cmd, ' ')

  return rc
}

function appendJoinedArray (str, key, array, join) {
  if (!Array.isArray(array)) return str
  return append(str, key, array.join(join), (joined) => {
    return key ? '"' + joined + '"' : joined
  })
}

function appendObjectKeys (str, key, obj, transformer) {
  let newStr = str
  Object.keys(obj).forEach((k) => {
    newStr = append(newStr, key, { 'key': k, val: obj[k] }, (agg) => {
      if (!agg.val) return agg.key
      let v = ''
      if (Array.isArray(agg.val)) {
        agg.val.forEach((valObj) => {
          v = (typeof transformer === 'function' ? transformer(valObj) : valObj)
        })
      }
      return (v ? v + ':' : '') + agg.key
    })
  })
  return newStr
}

function appendArray (str, key, array, transformer) {
  if (!Array.isArray(array)) return str
  let newStr = str
  array.forEach((v) => {
    newStr = append(newStr, key, v, transformer)
  })
  return newStr
}

function append (str, key, val, transformer) {
  if (!val) return str
  return str + ' ' + (key ? key + ' ' : '') + (typeof transformer === 'function' ? transformer(val) : val)
}
