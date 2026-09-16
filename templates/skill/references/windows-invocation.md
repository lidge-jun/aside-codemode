# Windows and ssh invocation

Aside's default shell on Windows is Git Bash. PowerShell is allowed for the same absolute
`{{NODE}} {{CLI}}` call. macOS uses the default bash/zsh card the same way. There is no
Linux install path.

## Do not pass a script as a quoted argument

Every shell here mangles a non-trivial script differently, and the failures do not look
alike:

- Git Bash: an unbalanced quote makes the command HANG waiting for the closing quote.
- PowerShell 5.1 and 7: the argument is re-parsed and comes back as `Unexpected token '}'`.
- ssh: the remote side re-splits the command string, so one round of quoting is lost.

Write the script to a file and pass the path, or pipe it on stdin:

    {{NODE}} {{CLI}} --code-file C:/abs/script.js
    type script.js | {{NODE}} {{CLI}} --code -

Over ssh, give the remote an argument array rather than one string, or write the file on
the remote first and pass only its path. A launcher that preserves `argv` is worth more
than another layer of escaping.

## Paths

Use absolute paths. Forward slashes work in Node on Windows and survive more shells than
backslashes do. A path containing a space, a quote, `&`, `$`, or non-ASCII characters is
ordinary and must still work: quote the whole path once, at the outermost layer, and do
not build the command by string concatenation in the middle.

CRLF in a script file is fine. CRLF inside a patch is not interchangeable with LF: keep
the target file's original newline.

## The browser over ssh

There is usually no focused window on an ssh session, so anything that means "the active
tab" returns `ENOACTIVE`. Name the tab with `targetId` or `urlIncludes` instead.

## The wire limit

A generated REPL script travels as a command-line argument. Windows caps a whole command
line at 32,767 characters, so the host refuses at 30,000 with `ESOURCETOOLONG` rather than
letting spawn fail with a message that names nothing; elsewhere the refusal is a
conservative 50,000 rather than the platform's own byte-based limit.

The refusal reports the breakdown: the total, the limit, and how much of it the urls are,
with the length and scheme of the longest one. Usually one of the two is true. If the urls
are small, the script is what grew: drop `helper`, drop `snapshot`, or split the batch. If
one url is most of the total it will be a `data:` url, which means the document itself is
on the wire — serve it over http from loopback and pass that url instead.
