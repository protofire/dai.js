import {default as ServiceBase, ServiceType} from "./ServiceBase";
import ServiceState from './ServiceState';

test('constructor() should throw on invalid init function', () => {
  expect(() => new ServiceBase("")).toThrow('Invalid argument init: not a function or null.');
  expect(() => new ServiceBase(false)).toThrow('Invalid argument init: not a function or null.');
});

test('constructor() should throw on invalid connect function', () => {
  expect(() => new ServiceBase(null, "")).toThrow('Invalid argument connect: not a function or null.');
  expect(() => new ServiceBase(null, false)).toThrow('Invalid argument connect: not a function or null.');
});

test('constructor() should throw on invalid auth function', () => {
  expect(() => new ServiceBase(null, null, "")).toThrow('Invalid argument auth: not a function or null.');
  expect(() => new ServiceBase(null, null, false)).toThrow('Invalid argument auth: not a function or null.');
});

test('constructor() should correctly set default lifecycle functions when they are omitted', () => {
  expect.assertions(3);
  new ServiceBase(null, () => {})._init().then((d) => expect(d).toBeFalsy());
  new ServiceBase(null, null, () => {})._init().then((d) => expect(d).toBeFalsy());
  new ServiceBase(null, null, () => {})._connect().then((d) => expect(d).toBeFalsy());
});

test('constructor() should correctly determine the service type', () => {
  expect(new ServiceBase()._type).toBe(ServiceType.LOCAL);
  expect(new ServiceBase(() => {})._type).toBe(ServiceType.LOCAL);
  expect(new ServiceBase(null, () => {})._type).toBe(ServiceType.PUBLIC);
  expect(new ServiceBase(null, null, () => {})._type).toBe(ServiceType.PRIVATE);
});

test('initialize() should call and wait for the provided init function when INITIALIZING', () => {
  let s = {}, called = false;
  expect.assertions(2);

  s.service = new ServiceBase(() => {
    expect(s.service._state.state()).toBe(ServiceState.INITIALIZING);
    called = true;
  });

  s.service.initialize().then(() => expect(called).toBe(true));
});

test('initialize() should correctly transition to READY/OFFLINE after successfully INITIALIZING', () => {
  expect.assertions(2);

  const s = new ServiceBase();
  s.initialize().then(() => expect(s._state.inState(ServiceState.READY)).toBe(true));
  const s2 = new ServiceBase(null, () => {});
  s2.initialize().then(() => expect(s2._state.inState(ServiceState.OFFLINE)).toBe(true));
});

test('initialize() should correctly revert back to CREATED after unsuccessfully INITIALIZING', () => {
  expect.assertions(2);

  const s = new ServiceBase(() => { throw new Error('InitError'); });
  s.initialize().then(() => { expect(s._state.state()).toBe(ServiceState.CREATED) });
  const s2 = new ServiceBase(() => { return Promise.reject('InitError'); });
  s2.initialize().then(() => { expect(s2._state.state()).toBe(ServiceState.CREATED) });
});

test('initialize() should correctly call onInitialized handlers and reflect state through the is* methods', (done) => {
  const s = {};
  let inits = 0;

  s.local = new ServiceBase()
    .onInitialized(() => inits++)
    .onInitialized(() => {
      expect(s.local._state.state()).toBe(ServiceState.READY);
      expect(s.local.isInitialized()).toBe(true);
      expect(s.local.isConnected()).toBe(null);
      expect(s.local.isAuthenticated()).toBe(null);
      expect(s.local.isReady()).toBe(true);

      inits++;
    });

  s.public = new ServiceBase(null, () => {})
    .onInitialized(() => inits++)
    .onInitialized(() => {
      expect(s.public._state.state()).toBe(ServiceState.OFFLINE);
      expect(s.public.isInitialized()).toBe(true);
      expect(s.public.isConnected()).toBe(false);
      expect(s.public.isAuthenticated()).toBe(null);
      expect(s.public.isReady()).toBe(false);

      inits++;
    });

  s.private = new ServiceBase(null, null, () => {})
    .onInitialized(() => inits++)
    .onInitialized(() => {
      expect(s.private._state.state()).toBe(ServiceState.OFFLINE);
      expect(s.private.isInitialized()).toBe(true);
      expect(s.private.isConnected()).toBe(false);
      expect(s.private.isAuthenticated()).toBe(false);
      expect(s.private.isReady()).toBe(false);

      inits++;
    });

  Promise
    .all([s.local.initialize(), s.public.initialize(), s.private.initialize()])
    .then(() => {
      expect(inits).toBe(6);
      done();
    });
});

test('initialize() should return the existing init promise when called twice, and should call init only once', () => {
  let called = 0;
  const s = new ServiceBase(() => { called++; });

  expect.assertions(3);

  const p1 = s.initialize();
  p1.then(() => expect(called).toBe(1));
  const p2 = s.initialize();
  p2.then(() => expect(called).toBe(1));

  expect(p2).toBe(p1);
});

test('connect() should first wait for OFFLINE and then call the provided connect function when CONNECTING', (done) => {
  let counter = 2;

  const
    proceed = () => { if (--counter < 1) done(); },
    output = ['CREATED > INITIALIZING', '== init ==', 'INITIALIZING > OFFLINE',
      'OFFLINE > CONNECTING', '== connect ==', 'CONNECTING > READY'],
    log1 = [],
    log2 = [],
    service1 = new ServiceBase(() => log1.push('== init =='), () => log1.push('== connect ==')),
    service2 = new ServiceBase(() => { log2.push('== init =='); }, () => { log2.push('== connect =='); });

  service1._state.onStateChanged((ns, os) => log1.push(ns + ' > ' + os));
  service2._state.onStateChanged((ns, os) => log2.push(ns + ' > ' + os));

  service1
    .initialize()
    .then(() => service1.connect())
    .then(() => { expect(log1).toEqual(output); proceed(); });

  service2
    .connect()
    .then(() => { expect(log2).toEqual(output); proceed(); });
});

test('connect() should correctly revert back to OFFLINE after unsuccessfully CONNECTING', (done) => {
  const s = new ServiceBase(null, () => { throw new Error('ConnectError'); });
  s.connect().then(() => { expect(s._state.state()).toBe(ServiceState.OFFLINE); done(); });
});

test('connect() should correctly call onConnected handlers and reflect state through the is* methods', (done) => {
  const s = {};
  let checkpoints = 0;

  s.local = new ServiceBase().onConnected(() => {
    throw new Error('onConnected must never be called on a local service');
  });

  s.public = new ServiceBase(null, () => {})
    .onConnected(() => checkpoints++)
    .onConnected(() => {
      expect(s.public._state.state()).toBe(ServiceState.READY);
      expect(s.public.isInitialized()).toBe(true);
      expect(s.public.isConnected()).toBe(true);
      expect(s.public.isAuthenticated()).toBe(null);
      expect(s.public.isReady()).toBe(true);

      checkpoints++;
    });

  s.private = new ServiceBase(null, null, () => {})
    .onConnected(() => checkpoints++)
    .onConnected(() => {
      expect(s.private._state.state()).toBe(ServiceState.ONLINE);
      expect(s.private.isInitialized()).toBe(true);
      expect(s.private.isConnected()).toBe(true);
      expect(s.private.isAuthenticated()).toBe(false);
      expect(s.private.isReady()).toBe(false);

      checkpoints++;
    });

  Promise
    .all([s.local.connect(), s.public.connect(), s.private.connect()])
    .then(() => {
      expect(checkpoints).toBe(4);
      done();
    });
});

test('connect() should return the existing connect promise when called twice, and should call connect only once', (done) => {
  let called = 0, counter = 3;

  const
    proceed = () => { if (--counter < 1) done(); },
    s = new ServiceBase(null, () => { called++; });

  const p1 = s.connect();
  p1.then(() => { expect(called).toBe(1); proceed(); });
  const p2 = s.connect();
  p2.then(() => { expect(called).toBe(1); proceed(); });

  expect(p2).toBe(p1);
  proceed();
});

test('connect() should pass a disconnect() function to the handler, allowing it to disconnect and reconnect', (done) => {
  let disconnect = null;
  const s = new ServiceBase(null, d => disconnect = d);

  s.connect().then(() => {
      expect(s._state.state()).toBe(ServiceState.READY);
      expect(typeof disconnect).toBe('function');
      disconnect();
      expect(s._state.state()).toBe(ServiceState.OFFLINE);
      return s.connect();
    })
    .then(() => {
      expect(s._state.state()).toBe(ServiceState.READY);
      done();
    });
});

test('_disconnect() should leave the state unchanged if called in an irrelevant state', () => {
  const s = new ServiceBase(null, () => {});
  s._disconnect();
  expect(s._state.state()).toBe(ServiceState.CREATED);
});

test('authenticate() should first wait for ONLINE and then call the provided auth function when AUTHENTICATING', (done) => {
  let counter = 2;

  const
    proceed = () => { if (--counter < 1) done(); },
    output = ['CREATED > INITIALIZING', '== init ==', 'INITIALIZING > OFFLINE',
      'OFFLINE > CONNECTING', '== connect ==', 'CONNECTING > ONLINE',
      'ONLINE > AUTHENTICATING', '== authenticate ==', 'AUTHENTICATING > READY'
    ],
    log1 = [],
    log2 = [],
    service1 = new ServiceBase(() => log1.push('== init =='), () => log1.push('== connect =='), () => log1.push('== authenticate ==')),
    service2 = new ServiceBase(() => log2.push('== init =='), () => log2.push('== connect =='), () => log2.push('== authenticate =='));

  service1._state.onStateChanged((ns, os) => log1.push(ns + ' > ' + os));
  service2._state.onStateChanged((ns, os) => log2.push(ns + ' > ' + os));

  service1
    .initialize()
    .then(() => service1.connect())
    .then(() => service1.authenticate())
    .then(() => { expect(log1).toEqual(output); proceed(); });

  service2
    .authenticate()
    .then(() => { expect(log2).toEqual(output); proceed(); });
});

test('authenticate() should correctly revert back to ONLINE after unsuccessfully AUTHENTICATING', (done) => {
  const s = new ServiceBase(null, null, () => { throw new Error('AuthError'); });
  s.authenticate().then(() => { expect(s._state.state()).toBe(ServiceState.ONLINE); done(); });
});

test('authenticate() should correctly call onAuthenticated handlers and reflect state through the is* methods', (done) => {
  const s = {};
  let checkpoints = 0;

  s.local = new ServiceBase().onAuthenticated(() => {
    throw new Error('onAuthenticated must never be called on a local service');
  });

  s.public = new ServiceBase(null, () => {}).onAuthenticated(() => {
    throw new Error('onAuthenticated must never be called on a public service');
  });

  s.private = new ServiceBase(null, null, () => {})
    .onAuthenticated(() => checkpoints++)
    .onAuthenticated(() => {
      expect(s.private._state.state()).toBe(ServiceState.READY);
      expect(s.private.isInitialized()).toBe(true);
      expect(s.private.isConnected()).toBe(true);
      expect(s.private.isAuthenticated()).toBe(true);
      expect(s.private.isReady()).toBe(true);

      checkpoints++;
    });

  Promise
    .all([s.local.authenticate(), s.public.authenticate(), s.private.authenticate()])
    .then(() => {
      expect(checkpoints).toBe(2);
      done();
    });
});

test('authenticate() should return the existing authenticate promise when called twice, and should call auth only once', (done) => {
  let called = 0, counter = 3;

  const
    proceed = () => { if (--counter < 1) done(); },
    s = new ServiceBase(null, null, () => { called++; });

  const p1 = s.authenticate();
  p1.then(() => { expect(called).toBe(1); proceed(); });
  const p2 = s.authenticate();
  p2.then(() => { expect(called).toBe(1); proceed(); });

  expect(p2).toBe(p1);
  proceed();
});

test('authenticate() should pass a working deauthenticate() function to the handler', (done) => {
  let deauthenticate = null, checkpoints = 0;
  const s = new ServiceBase(null, null, d => deauthenticate = d);
  
  s.authenticate().then(() => {
    expect(s._state.state()).toBe(ServiceState.READY);
    expect(typeof deauthenticate).toBe('function');
    checkpoints++;
    
    deauthenticate();
    
    expect(s._state.state()).toBe(ServiceState.ONLINE);
    checkpoints++;
    
    return s.authenticate();

  }).then(() => {
    expect(s._state.state()).toBe(ServiceState.READY);
    checkpoints++;

  }).then(() => {
    expect(checkpoints).toBe(3);
    done();
  });

});

test('_deauthenticate() should leave the state unchanged if called in an irrelevant state', () => {
  const s = new ServiceBase(null, null, () => {});
  expect.assertions(2);

  s.initialize().then(() => {
    expect(s._state.state()).toBe(ServiceState.OFFLINE);
    s._deauthenticate();
    expect(s._state.state()).toBe(ServiceState.OFFLINE);
  });
});

test('should correctly deauthenticate when disconnecting during the READY state.', (done) => {
  let disconnect = null, checkpoints = 0;
  const s = new ServiceBase(null, d => disconnect = d, () => {});

  expect(s._type).toBe(ServiceType.PRIVATE);

  s.authenticate().then(() => {
    expect(s._state.state()).toBe(ServiceState.READY);
    expect(typeof disconnect).toBe('function');
    checkpoints++;

    disconnect();

    expect(s._state.state()).toBe(ServiceState.OFFLINE);
    checkpoints++;

    return s.authenticate();

  }).then(() => {
    expect(s._state.state()).toBe(ServiceState.READY);
    checkpoints++;
    
  }).then(() => {
    expect(checkpoints).toBe(3);
    done();
  });
});

test('should correctly handle a disconnect in the AUTHENTICATING state.', (done) => {
  let disconnect = null, checkpoints = 0, s = {};

  s.service = new ServiceBase(
    null,
    d => disconnect = d,
    () => {
      expect(typeof disconnect).toBe('function');
      expect(s.service._state.state()).toBe(ServiceState.AUTHENTICATING);

      // Only disconnect the first time, not when reauthenticating
      if (checkpoints < 1) {
        disconnect();
      }

      checkpoints++;
    }
  );

  expect(s.service._type).toBe(ServiceType.PRIVATE);

  s.service.authenticate().then(() => {
    expect(s.service._state.state()).toBe(ServiceState.OFFLINE);
    checkpoints++;

    // Try and reauthenticate
    return s.service.authenticate();

  }).then(() => {
    expect(s.service._state.state()).toBe(ServiceState.READY);
    checkpoints++;

  }).then(() => {
    expect(checkpoints).toBe(4);
    done();
  });

});