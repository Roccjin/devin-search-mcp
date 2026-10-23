import type { LoginInteraction } from '../third_party/dsh-devin-search/packages/pi-devin-search/src/session.js';
import { presentStatus, withholdCredentials } from './format.js';
import type { SearchRuntime } from './runtime.js';

const LINK_WAIT_MS = 15_000;

export function loginLinkText(url: string, opened: boolean): string {
  const lines = [
    'Not logged in. Show this link to the user now, then stop.',
    'After the browser says the callback was accepted, call the tool again.',
    'Do not paste an authorization code into the chat.',
    'Do not run devin-login, and do not wait on a login command in the shell. This process is already waiting for the callback.',
  ];
  if (opened) lines.push('A browser window was requested for this link.');
  lines.push(url);
  return lines.join('\n');
}

interface Slot {
  url?: string;
  ready?: Promise<string>;
  opened: boolean;
}

const slots = new WeakMap<SearchRuntime, Slot>();

function slotFor(runtime: SearchRuntime): Slot {
  let slot = slots.get(runtime);
  if (!slot) {
    slot = { opened: false };
    slots.set(runtime, slot);
  }
  return slot;
}

function begin(runtime: SearchRuntime, slot: Slot): Promise<string> {
  let resolveUrl!: (url: string) => void;
  let rejectUrl!: (error: Error) => void;
  let settled = false;
  const urlReady = new Promise<string>((resolve, reject) => {
    resolveUrl = url => {
      if (settled) return;
      settled = true;
      resolve(url);
    };
    rejectUrl = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
  });
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    rejectUrl(new Error('Login link was not ready.'));
  }, LINK_WAIT_MS);
  const interaction: LoginInteraction = {
    hasUI: true,
    notify(url) {
      clearTimeout(timer);
      slot.url = url;
      if (!slot.opened) {
        slot.opened = true;
        try { runtime.openLogin(url); } catch { /* the link is still returned */ }
      }
      resolveUrl(url);
    },
    prompt() {
      return Promise.reject(new Error('Loopback login does not accept a pasted code.'));
    },
  };
  // The tool returns at notify. Aborting after that would cancel the click the user has not made yet.
  const ready = urlReady;
  slot.ready = ready;
  void runtime.session.login(interaction, controller.signal, 'loopback').then(message => {
    clearTimeout(timer);
    if (settled) return;
    if (message.startsWith('Already logged in') || message.startsWith('Login saved')) resolveUrl('');
    else rejectUrl(new Error(message));
  }, error => {
    clearTimeout(timer);
    rejectUrl(error instanceof Error ? error : new Error('Login link was not ready.'));
  }).finally(() => {
    if (slot.ready === ready) {
      slot.ready = undefined;
      slot.url = undefined;
      slot.opened = false;
    }
  });
  return ready;
}

/** Start one loopback login and return as soon as the clickable URL exists. */
export async function ensureLoginLink(runtime: SearchRuntime): Promise<string> {
  await runtime.session.status();
  if (runtime.session.available()) return presentStatus(await runtime.session.status(), false);
  const slot = slotFor(runtime);
  if (slot.url) return withholdCredentials(loginLinkText(slot.url, slot.opened));
  if (!slot.ready) begin(runtime, slot);
  try {
    const url = await slot.ready;
    if (!url || runtime.session.available()) return presentStatus(await runtime.session.status(), false);
    return withholdCredentials(loginLinkText(url, slot.opened));
  } catch (error) {
    if (slot.ready) slot.ready = undefined;
    const detail = error instanceof Error ? error.message : 'Login link was not ready.';
    return withholdCredentials(`${detail} Run devin-login in a terminal. Do not paste an authorization code into the chat.`);
  }
}
