import { useState } from 'react';
import { rememberedName, rememberedRoom } from '../socket.js';
import type { JoinInfo } from '../App.js';

interface Props {
  onJoin: (info: JoinInfo) => void;
  busy: boolean;
}

export function Landing({ onJoin, busy }: Props) {
  const [name, setName] = useState(rememberedName());
  const [roomCode, setRoomCode] = useState(rememberedRoom());

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onJoin({ name: name.trim(), roomCode: roomCode.trim() });
  };

  const createRoom = () => {
    onJoin({ name: name.trim(), roomCode: '' });
  };

  return (
    <form className="landing" onSubmit={submit}>
      <h2>Play Hidden Trump</h2>
      <p className="muted">
        Four players, two teams, thirteen tricks. One of you sets a secret trump card face down — and the
        round only ends when somebody can no longer reach their bid.
      </p>

      <label htmlFor="name">Your name</label>
      <input
        id="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Alex"
        autoComplete="nickname"
        maxLength={20}
        required
      />

      <label htmlFor="room">Room code</label>
      <input
        id="room"
        value={roomCode}
        onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
        placeholder="Leave blank for a new room"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        maxLength={8}
      />

      <button type="submit" className="primary" disabled={busy || name.trim().length === 0}>
        {busy ? 'Joining…' : 'Join room'}
      </button>
      <button type="button" className="ghost" onClick={createRoom} disabled={busy || name.trim().length === 0}>
        Create a new room
      </button>
      <p className="muted small">
        Share this website and your room code with three friends. Each player joins from their own phone or laptop.
      </p>
      <p className="muted small">
        Refreshing this page keeps your seat and your hand. You can also use separate tabs for local testing.
      </p>
    </form>
  );
}
