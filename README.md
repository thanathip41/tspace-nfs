# tspace-nfs

[![NPM version](https://img.shields.io/npm/v/tspace-nfs.svg)](https://www.npmjs.com)
[![NPM downloads](https://img.shields.io/npm/dm/tspace-nfs.svg)](https://www.npmjs.com)

tspace-nfs is a NFS stands for Network File System and provides both server and client capabilities for accessing files over a network.

## Install

Install with [npm](https://www.npmjs.com/):

```sh
npm install tspace-nfs --save

```
## Basic Usage
- [Server](#server)
- [Client](#client)

## Server
```js
import { NfsServer } from "tspace-nfs";

new NfsServer()
.onCredentials(async ({ token , secret , bucket }) => {

  // In this simple example, you can use any database as a wrapper to check the credentials.
  const lists = [
    {
      token: 'token-dev',
      secret: 'secret-dev',
      bucket : 'dev'
    }
  ]
  return lists.some(list => list.bucket === bucket && list.secret === secret && list.token === token)
})
.defaultPage(`<b> hello nfs-server! </b>`)
.directory('nfs')
.credentials({
  expired : 1000 * 60 * 60 * 24, // by default 1 hour
  secret  : 'credential-secret'
}) // the credentials will auto refresh every expired
fileExpired(60 * 15) // 15 minutes by default 1 hour
.listen(8000 , ({ port }) => console.log(`Server is running on port http://localhost:${port}`))

```
## Client
```js
import { NfsClient } from "tspace-nfs";

const nfs = new NfsClient({
  token     : '<YOUR TOKEN>',   // token
  secret    : '<YOUR SECRET>',  // secret
  bucket    : '<YOUR BUCKET>',  // bucket name
  url       : '<YOUR URL>'      // https://nfs-server.example.com
})
.onError((err, nfs) => {
  console.log('nfs client failed to connect')
  console.log(err.message)
  nfs.quit()
})
.onConnect((nfs) => {
  console.log('nfs client connected')
})

(async () => {

  const fileDirectory = 'my-cat.png'

  const url = await nfs.toURL(fileDirectory , { download : false }) // default download true

  const base64 = await nfs.toBase64(fileDirectory)

  const stream = await nfs.toStream(fileDirectory)

  const file = files[0] // assume the file from your upload

  await nfs.upload({
    file : file.tempFilePath,
    name : 'my-video.mp4',
    folder : 'my-folder'
  })

   await nfs.uploadBase64({
    base64 :  Buffer.from(file.tempFilePath).toString('base64'),
    name   : 'my-video.mp4',
    folder : 'my-folder'
  })

  const deleted = await nfs.delete(fileDirectory)

  const storage = await nfs.storage()

})()

```