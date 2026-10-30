// Browser stand-in for the one `node:crypto` export Main's Agent actor uses.
export const randomUUID = () => crypto.randomUUID();
