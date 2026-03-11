import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  ensureSession,
  getAllChats,
  getAllRegisteredProjects,
  getAllSessions,
  getAllSchedules,
  getMessagesSince,
  getNewMessages,
  setRegisteredProject,
  storeChatMetadata,
  storeMessage,
  getRecentMessages,
} from './db.js';

beforeEach(() => {
  _initTestDatabase();
});

// Helper to store a message using the normalized NewMessage interface
function store(overrides: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
}) {
  storeMessage({
    id: overrides.id,
    chat_jid: overrides.chat_jid,
    sender: overrides.sender,
    sender_name: overrides.sender_name,
    content: overrides.content,
    timestamp: overrides.timestamp,
    is_from_me: overrides.is_from_me ?? false,
  });
}

function createSession(overrides?: { agent_id?: string; session_id?: string }) {
  return ensureSession({
    agent_id: overrides?.agent_id || 'agent-1',
    session_id: overrides?.session_id || 'session-1',
    channel: 'test',
    agent_name: 'Agent 1',
  });
}

// --- storeMessage (NewMessage format) ---

describe('storeMessage', () => {
  it('stores a message and retrieves it', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-1',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'hello world',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[0].sender).toBe('123@s.whatsapp.net');
    expect(messages[0].sender_name).toBe('Alice');
    expect(messages[0].content).toBe('hello world');
  });

  it('filters out empty content', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-2',
      chat_jid: 'group@g.us',
      sender: '111@s.whatsapp.net',
      sender_name: 'Bob',
      content: '',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    expect(messages).toHaveLength(0);
  });
});

// --- getNewMessages ---

describe('getNewMessages', () => {
  it('returns messages after last known timestamp', () => {
    storeChatMetadata('a@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-old',
      chat_jid: 'a@g.us',
      sender: 'u1@s.whatsapp.net',
      sender_name: 'User 1',
      content: 'old message',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    store({
      id: 'msg-new',
      chat_jid: 'a@g.us',
      sender: 'u2@s.whatsapp.net',
      sender_name: 'User 2',
      content: 'new message',
      timestamp: '2024-01-01T00:01:00.000Z',
    });

    const result = getNewMessages(
      ['a@g.us'],
      '2024-01-01T00:00:30.000Z',
      'Andy',
    );
    const msgs = result.messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('new message');
  });
});

// --- getAllChats ---

describe('getAllChats', () => {
  it('returns chat metadata after storing', () => {
    storeChatMetadata('g1@g.us', '2024-01-01T00:00:00.000Z', 'Group 1');
    storeChatMetadata('g2@g.us', '2024-01-01T00:01:00.000Z', 'Group 2');

    const chats = getAllChats();
    expect(chats).toHaveLength(2);
    expect(chats.map((c) => c.jid)).toContain('g1@g.us');
    expect(chats.map((c) => c.jid)).toContain('g2@g.us');
  });
});

// --- Session tests ---

describe('session topology', () => {
  it('creates isolated session records for one agent', () => {
    const sessionA = createSession({ session_id: 'session-a' });
    const sessionB = createSession({ session_id: 'session-b' });

    expect(sessionA.agent_id).toBe('agent-1');
    expect(sessionA.session_id).toBe('session-a');
    expect(sessionB.session_id).toBe('session-b');

    const sessions = getAllSessions();
    expect(sessions).toHaveLength(2);
  });
});

// --- RegisteredProject isMain round-trip ---

describe('registered project isMain', () => {
  it('persists isMain=true through set/get round-trip', () => {
    setRegisteredProject('main@s.whatsapp.net', {
      name: 'Main Chat',
      folder: 'whatsapp_main',
      agent_id: 'agent-main',
      trigger: '@Andy',
      added_at: '2024-01-01T00:00:00.000Z',
      isMain: true,
    });

    const projects = getAllRegisteredProjects();
    const project = projects['main@s.whatsapp.net'];
    expect(project).toBeDefined();
    expect(project.isMain).toBe(true);
    expect(project.folder).toBe('whatsapp_main');
    expect(project.agent_id).toBe('agent-main');
  });

  it('omits isMain for non-main projects', () => {
    setRegisteredProject('group@g.us', {
      name: 'Family Chat',
      folder: 'whatsapp_family-chat',
      agent_id: 'agent-family',
      trigger: '@Andy',
      added_at: '2024-01-01T00:00:00.000Z',
    });

    const projects = getAllRegisteredProjects();
    const project = projects['group@g.us'];
    expect(project).toBeDefined();
    expect(project.isMain).toBeUndefined();
    expect(project.agent_id).toBe('agent-family');
  });
});
