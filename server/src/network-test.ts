import { logger } from './logger';
import * as dgram from 'dgram';
import * as stun from 'stun';

export class NetworkTest {
  private static readonly STUN_SERVERS = [
    { url: 'stun:stun.l.google.com:19302' },
    { url: 'stun:stun1.l.google.com:19302' },
    { url: 'stun:stun2.l.google.com:19302' },
    { url: 'stun:stun3.l.google.com:19302' },
    { url: 'stun:stun4.l.google.com:19302' }
  ];

  private static readonly UDP_PORT_RANGE = {
    start: 40000,
    end: 49999
  };

  static async testStunServers(): Promise<void> {
    for (const server of this.STUN_SERVERS) {
      try {
        const { url } = server;
        const [, host, port] = url.match(/^stun:([^:]+):(\d+)$/) || [];
        
        if (!host || !port) {
          logger.error(`Invalid STUN server URL: ${url}`);
          continue;
        }

        const socket = dgram.createSocket('udp4');
        const request = stun.createMessage(stun.constants.STUN_BINDING_REQUEST);

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            socket.close();
            reject(new Error(`STUN request timeout for ${url}`));
          }, 5000);

          socket.on('message', (msg) => {
            try {
              const response = stun.decode(msg);
              if (response.type === stun.constants.STUN_BINDING_RESPONSE) {
                const { address, port } = response.attrs;
                logger.info(`STUN test successful for ${url}:`, {
                  publicAddress: address,
                  publicPort: port
                });
                clearTimeout(timeout);
                socket.close();
                resolve();
              }
            } catch (error) {
              logger.error(`Failed to decode STUN response from ${url}:`, error);
              clearTimeout(timeout);
              socket.close();
              reject(error);
            }
          });

          socket.on('error', (error) => {
            logger.error(`Socket error for ${url}:`, error);
            clearTimeout(timeout);
            socket.close();
            reject(error);
          });

          socket.send(request.toBuffer(), parseInt(port), host, (error) => {
            if (error) {
              logger.error(`Failed to send STUN request to ${url}:`, error);
              clearTimeout(timeout);
              socket.close();
              reject(error);
            }
          });
        });

      } catch (error) {
        logger.error(`STUN test failed for ${server.url}:`, error);
      }
    }
  }

  static async testUdpPorts(): Promise<void> {
    for (let port = this.UDP_PORT_RANGE.start; port <= this.UDP_PORT_RANGE.end; port++) {
      try {
        const socket = dgram.createSocket('udp4');
        
        await new Promise<void>((resolve, reject) => {
          socket.on('error', (error) => {
            if ((error as any).code === 'EADDRINUSE') {
              logger.warn(`UDP port ${port} is in use`);
            } else {
              logger.error(`Error testing UDP port ${port}:`, error);
            }
            socket.close();
            resolve();
          });

          socket.bind(port, '0.0.0.0', () => {
            logger.info(`UDP port ${port} is available`);
            socket.close();
            resolve();
          });
        });

      } catch (error) {
        logger.error(`Failed to test UDP port ${port}:`, error);
      }
    }
  }

  static async runTests(): Promise<void> {
    logger.info('Starting network tests...');
    
    logger.info('Testing STUN servers...');
    await this.testStunServers();
    
    logger.info('Testing UDP ports...');
    await this.testUdpPorts();
    
    logger.info('Network tests completed');
  }
}

// Запускаем тесты если скрипт запущен напрямую
if (require.main === module) {
  NetworkTest.runTests().catch((error) => {
    logger.error('Network tests failed:', error);
    process.exit(1);
  });
} 