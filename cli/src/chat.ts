import { Command } from 'commander';
import crypto from 'crypto';
import http from 'http';

class StreamMarkdownPrinter {
  private inCodeBlock = false;
  private buffer = '';
  private rawMode: boolean;

  constructor(rawMode: boolean) {
    this.rawMode = rawMode;
  }

  public print(chunk: string) {
    if (this.rawMode) {
      process.stdout.write(chunk);
      return;
    }

    this.buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIndex + 1);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.processLine(line);
    }
  }

  public flush() {
    if (this.rawMode) return;
    if (this.buffer.length > 0) {
      this.processLine(this.buffer);
      this.buffer = '';
    }
  }

  private processLine(line: string) {
    if (line.trim().startsWith('```')) {
      this.inCodeBlock = !this.inCodeBlock;
      process.stdout.write(`\x1b[90m${line}\x1b[0m`);
      return;
    }

    if (this.inCodeBlock) {
      process.stdout.write(`\x1b[36m${line}\x1b[0m`);
      return;
    }

    let formatted = line;
    if (/^#+\s/.test(formatted)) {
      formatted = `\x1b[1m\x1b[34m${formatted}\x1b[0m`;
      process.stdout.write(formatted);
      return;
    }

    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '\x1b[1m$1\x1b[0m');
    formatted = formatted.replace(/`([^`]+)`/g, '\x1b[33m`$1`\x1b[0m');

    process.stdout.write(formatted);
  }
}

export function registerChatCommand(program: Command) {
  program
    .command('chat <message>')
    .description(
      'Send a chat message to a local Tix agent and stream the response',
    )
    .option('-a, --agent <id>', 'Target agent ID (defaults to "default")')
    .option('-s, --session <id>', 'Session ID (reuse for multi-turn context)')
    .option('-r, --raw', 'Output raw markdown instead of rendering it')
    .option('-j, --json', 'Output JSON with response, task_id, and elapsed_ms')
    .option('-t, --timeout <seconds>', 'Timeout in seconds (default: 120)', '120')
    .option('-p, --port <port>', 'Server port (default: 2755)', '2755')
    .action(async (message: string, options) => {
      const agentId = options.agent || 'default';
      const sessionId = options.session || `cli-${crypto.randomUUID()}`;
      const taskId = crypto.randomUUID();
      const port = parseInt(options.port, 10) || 2755;
      const timeoutMs = (parseInt(options.timeout, 10) || 120) * 1000;
      const jsonMode = !!options.json;
      const rawMode = !!options.raw || jsonMode;
      const printer = new StreamMarkdownPrinter(rawMode);
      let activeStreamId: string | null = null;
      let lastStreamSeq = 0;
      let renderedText = '';
      const ttyProgress = !!process.stderr.isTTY && !jsonMode;
      let activeProgress = '';
      const startTime = Date.now();

      const clearProgress = () => {
        if (!activeProgress) return;
        if (ttyProgress) {
          process.stderr.write('\r\x1b[2K');
        } else if (!jsonMode) {
          process.stderr.write('\n');
        }
        activeProgress = '';
      };

      const showProgress = (text: string) => {
        if (jsonMode) return;
        const normalized = text.replace(/\s+/g, ' ').trim();
        if (!normalized || normalized === activeProgress) return;
        activeProgress = normalized;
        if (ttyProgress) {
          process.stderr.write(`\r\x1b[2K${normalized}`);
        } else {
          process.stderr.write(`${normalized}\n`);
        }
      };

      if (!jsonMode) {
        console.log(`\x1b[36mConnecting to agent '${agentId}' (session: ${sessionId})...\x1b[0m`);
      }

      const advanceStreamEvent = (event: {
        stream_id?: string;
        seq?: number;
      }): {
        isDuplicate: boolean;
        isNewStream: boolean;
      } => {
        const streamId =
          typeof event.stream_id === 'string' && event.stream_id.trim()
            ? event.stream_id
            : null;
        const seq = typeof event.seq === 'number' ? event.seq : null;

        if (!streamId || seq === null) {
          return {
            isDuplicate: false,
            isNewStream: false,
          };
        }

        const isNewStream = streamId !== activeStreamId;
        if (!isNewStream && seq <= lastStreamSeq) {
          return {
            isDuplicate: true,
            isNewStream: false,
          };
        }

        activeStreamId = streamId;
        lastStreamSeq = seq;
        if (isNewStream) {
          renderedText = '';
        }

        return {
          isDuplicate: false,
          isNewStream,
        };
      };

      const printStreamEvent = (event: {
        text?: string;
        full_text?: string;
      }) => {
        const fullText =
          typeof event.full_text === 'string' ? event.full_text : null;

        if (fullText !== null) {
          const suffix = fullText.startsWith(renderedText)
            ? fullText.slice(renderedText.length)
            : fullText;
          if (suffix) {
            if (!jsonMode) printer.print(suffix);
          }
          renderedText = fullText;
          return;
        }

        if (typeof event.text === 'string' && event.text) {
          if (!jsonMode) printer.print(event.text);
          renderedText += event.text;
        }
      };

      const finish = (responseText: string) => {
        clearProgress();
        if (jsonMode) {
          const result = {
            response: responseText.trim(),
            agent_id: agentId,
            session_id: sessionId,
            task_id: taskId,
            elapsed_ms: Date.now() - startTime,
          };
          // Wait for stdout to flush before exiting — prevents data loss in $() subshells
          const ok = process.stdout.write(JSON.stringify(result) + '\n');
          if (ok) {
            process.exit(0);
          } else {
            process.stdout.once('drain', () => process.exit(0));
          }
        } else {
          printer.flush();
          console.log('\n');
          process.exit(0);
        }
      };

      // Timeout handler
      const timeoutTimer = setTimeout(() => {
        clearProgress();
        if (jsonMode) {
          const result = {
            error: 'timeout',
            message: `No response within ${options.timeout}s`,
            agent_id: agentId,
            session_id: sessionId,
            task_id: taskId,
            elapsed_ms: Date.now() - startTime,
          };
          process.stdout.write(JSON.stringify(result) + '\n');
        } else {
          console.error(
            `\x1b[31mTimeout: No response within ${options.timeout} seconds\x1b[0m`,
          );
        }
        process.exit(2);
      }, timeoutMs);

      try {
        // Step 1: Connect to the SSE stream to listen for events
        const streamUrl = new URL(
          `http://localhost:${port}/runs/${agentId}/stream`,
        );
        streamUrl.searchParams.set('agent_id', agentId);
        streamUrl.searchParams.set('session_id', sessionId);

        const sseReq = http.get(streamUrl.toString(), (res) => {
          if (res.statusCode !== 200) {
            clearTimeout(timeoutTimer);
            if (jsonMode) {
              process.stdout.write(JSON.stringify({ error: 'stream_failed', status: res.statusCode }) + '\n');
            } else {
              console.error(
                `\x1b[31mFailed to connect to stream: ${res.statusCode}\x1b[0m`,
              );
            }
            process.exit(1);
          }

          let buffer = '';

          res.on('data', (chunk) => {
            buffer += chunk.toString();
            let newlineIndex;

            while ((newlineIndex = buffer.indexOf('\n\n')) >= 0) {
              const messageChunk = buffer.slice(0, newlineIndex);
              buffer = buffer.slice(newlineIndex + 2);

              if (messageChunk.startsWith('data: ')) {
                const dataString = messageChunk.slice(6);
                if (dataString === ': ping') continue;

                try {
                  const event = JSON.parse(dataString);

                  if (event.type === 'connected') {
                    // Ready to push the message now that the stream is open!
                    dispatchMessage();
                  } else if (event.type === 'progress' && event.text) {
                    showProgress(event.text);
                  } else if (event.type === 'stream_delta') {
                    clearProgress();
                    const { isDuplicate } = advanceStreamEvent(event);
                    if (!isDuplicate) {
                      printStreamEvent(event);
                    }
                  } else if (event.type === 'stream_end') {
                    clearTimeout(timeoutTimer);
                    const { isDuplicate } = advanceStreamEvent(event);
                    if (!isDuplicate) {
                      printStreamEvent(event);
                    }
                    finish(renderedText);
                  } else if (event.type === 'progress_end') {
                    clearProgress();
                  } else if (event.type === 'message' && event.text) {
                    clearTimeout(timeoutTimer);
                    if (!renderedText) {
                      renderedText = event.text;
                    }
                    finish(renderedText || event.text);
                  }
                } catch (e) {
                  // Ignore parse errors on malformed chunks or bare ping messages
                }
              }
            }
          });

          res.on('error', (err) => {
            clearTimeout(timeoutTimer);
            clearProgress();
            if (jsonMode) {
              process.stdout.write(JSON.stringify({ error: 'stream_error', message: err.message }) + '\n');
            } else {
              console.error(`\x1b[31mStream error: ${err.message}\x1b[0m`);
            }
            process.exit(1);
          });
        });

        sseReq.on('error', (err: any) => {
          clearTimeout(timeoutTimer);
          clearProgress();
          if (jsonMode) {
            process.stdout.write(JSON.stringify({
              error: err.code === 'ECONNREFUSED' ? 'connection_refused' : 'connection_error',
              message: err.message,
            }) + '\n');
          } else {
            if (err.code === 'ECONNREFUSED') {
              console.error(
                `\x1b[31mConnection refused: Is the Tix service running (pnpm dev)?\x1b[0m`,
              );
            } else {
              console.error(`\x1b[31mFailed to connect: ${err.message}\x1b[0m`);
            }
          }
          process.exit(1);
        });

        // Step 2: Fire the message into the channel
        const dispatchMessage = async () => {
          try {
            const response = await fetch(`http://localhost:${port}/runs`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                agent_id: agentId,
                session_id: sessionId,
                task_id: taskId,
                content: message,
                sender: 'cli',
                sender_name: 'CLI User',
              }),
            });

            if (!response.ok) {
              clearTimeout(timeoutTimer);
              clearProgress();
              const text = await response.text();
              if (jsonMode) {
                process.stdout.write(JSON.stringify({ error: 'send_failed', status: response.status, detail: text }) + '\n');
              } else {
                console.error(
                  `\x1b[31mFailed to send message: HTTP ${response.status}\x1b[0m`,
                );
                console.error(text);
              }
              process.exit(1);
            }
            if (!jsonMode) {
              console.log(
                `\x1b[32mMessage sent! Waiting for response...\x1b[0m\n`,
              );
            }
          } catch (err: any) {
            clearTimeout(timeoutTimer);
            clearProgress();
            if (jsonMode) {
              process.stdout.write(JSON.stringify({ error: 'dispatch_error', message: err.message }) + '\n');
            } else {
              console.error(
                `\x1b[31mError dispatching message: ${err.message}\x1b[0m`,
              );
            }
            process.exit(1);
          }
        };
      } catch (err: any) {
        clearTimeout(timeoutTimer);
        clearProgress();
        if (jsonMode) {
          process.stdout.write(JSON.stringify({ error: 'unexpected', message: err.message }) + '\n');
        } else {
          console.error(`\x1b[31mUnexpected Error: ${err.message}\x1b[0m`);
        }
        process.exit(1);
      }
    });
}
