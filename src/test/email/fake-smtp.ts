import { createServer, type Server, type Socket } from "node:net";

/**
 * Just enough of an SMTP server, on a loopback port, to watch what a real
 * nodemailer client does when it's offered no encryption at all — which is the
 * case the TLS rules exist for. It never speaks TLS, so a client configured to require either has to give up before it sends
 * anything, and `commands` shows whether it did.
 *
 * Hand-rolled rather than a dependency: the conversation is six commands long,
 * and the point is a server that is plainly *not* secure, which a real SMTP
 * library would make harder, not easier.
 */
export type FakeSmtp = {
  port: number;
  /** Every command line received, in order — `DATA` payloads excluded. */
  commands: string[];
  /** The raw message bodies that made it through `DATA`. */
  messages: string[];
  close: () => Promise<void>;
};

/**
 * `advertiseStartTls` makes it claim STARTTLS in its EHLO reply and then refuse
 * the upgrade when asked — standing in for a local relay whose certificate the
 * client wouldn't accept, without generating one.
 */
export async function startFakeSmtp({ advertiseStartTls = false } = {}): Promise<FakeSmtp> {
  const commands: string[] = [];
  const messages: string[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    // A client that expected TLS sends a ClientHello and then hangs up or
    // resets; neither is this server's problem.
    socket.on("error", () => {});

    let buffer = "";
    let inData = false;
    let body = "";

    socket.write("220 fake.test ESMTP\r\n");

    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      let newline: number;
      while ((newline = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push(body);
            body = "";
            socket.write("250 2.0.0 queued\r\n");
          } else {
            body += `${line}\r\n`;
          }
          continue;
        }

        commands.push(line);
        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO") {
          const starttls = advertiseStartTls ? "250-STARTTLS\r\n" : "";
          socket.write(`250-fake.test\r\n${starttls}250 8BITMIME\r\n`);
        } else if (verb === "STARTTLS") socket.write("454 4.7.0 TLS not available\r\n");
        else if (verb === "DATA") {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (verb === "QUIT") socket.end("221 bye\r\n");
        else if (verb === "MAIL" || verb === "RCPT" || verb === "RSET" || verb === "NOOP") {
          socket.write("250 ok\r\n");
        } else socket.write("502 not implemented\r\n");
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");

  return {
    port: address.port,
    commands,
    messages,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
