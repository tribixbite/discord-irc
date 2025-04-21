import events from 'events';

class ClientStub extends events.EventEmitter {
  nick;
  constructor(...args) {
    super();
    this.nick = args[1];
  }

  disconnect() {}

  say() {}
  send() {}
  join() {}
}

export default ClientStub;
