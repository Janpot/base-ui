import * as React from 'react';

let set: Set<string>;
if (process.env.NODE_ENV !== 'production') {
  set = new Set<string>();
}

export function error(...messages: string[]) {
  if (process.env.NODE_ENV !== 'production') {
    const ownerStack = React.captureOwnerStack?.() ?? '';
    const messageKey = messages.join(' ') + ownerStack;
    if (!set.has(messageKey)) {
      set.add(messageKey);
      console.error(`Base UI: ${messageKey}`);
    }
  }
}
