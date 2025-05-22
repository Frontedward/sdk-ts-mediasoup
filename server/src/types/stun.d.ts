declare module 'stun' {
  export interface StunMessage {
    type: number;
    attrs: {
      address?: string;
      port?: number;
      [key: string]: any;
    };
    toBuffer(): Buffer;
  }

  export interface StunConstants {
    STUN_BINDING_REQUEST: number;
    STUN_BINDING_RESPONSE: number;
  }

  export const constants: StunConstants;
  export function createMessage(type: number): StunMessage;
  export function decode(message: Buffer): StunMessage;
} 