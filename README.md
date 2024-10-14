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
.bucketLists(async () => {
  // The simple example, you can use any database or another to inform the server about the available bucket lists.
  return ['dev']
})
.onStudioCredentials(async ({ username , password }) => {
    
    const credentials = [
        {
            buckets : ['*'],
            username: 'root',
            password: 'root',
        }
    ]

    const find = credentials.find(v => v.username === username && v.password === password )

    const result = {
        logged : find == null ? false : true,
        buckets : find == null ? [] : find?.buckets
    }

    return result
})
.onCredentials(async ({ token , secret , bucket }) => {

  // The simple example, you can use any database or another to a wrapper check the credentials.
  const lists = [
    {
      token: 'token-dev',
      secret: 'secret-dev',
      bucket : 'dev'
    }
  ]
  return lists.every(list => list.bucket === bucket && list.secret === secret && list.token === token)
})
.progress() // view the progress of the file upload.
.defaultPage(`<b> hello nfs-server! </b>`)
.directory('upload') // by default nfs
.credentials({
  expired : 60 * 60 * 24, // 24 hours by default 1 hour
  secret  : 'credential-secret'
}) // the credentials will auto refresh every expired
.fileExpired(60 * 15) // 15 minutes by default 1 hour
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
.default('_default/uploads') // default folder prefix every the path
.onError((err, nfs) => {
  console.log('nfs client failed to connect')
  console.log(err.message)
  nfs.quit()
})
.onConnect((nfs) => {
  console.log('nfs client connected')
})

// example
(async () => {

  const fileDirectory = 'my-folder/my-cat.png'

  const url = await nfs.toURL(fileDirectory , { 
    download : false,   // default download true 
    expired  : 60 * 60  // seconds default expired 1 hour
    exists   : true     // default exists false for check if the file exists
  }) 
  
  const base64 = await nfs.toBase64(fileDirectory)

  const stream = await nfs.toStream(fileDirectory)

  const file = req.files.file[0] // assume the file from your upload

  const { path , size , name , url } =  await nfs.save({ // can you use nfs.upload too
    file : file.tempFilePath,
    name : 'my-video.mp4',
    folder : 'my-folder'
  })

  await nfs.saveAs({ // can you use nfs.uploadBase64 too
    base64 :  Buffer.from(file.tempFilePath).toString('base64'),
    name   : 'my-video.mp4',
    extension : 'mp4',
    folder : 'my-folder'
  })

  const deleted = await nfs.delete(fileDirectory)

  const folders = await nfs.folders()

  const storage = await nfs.storage()

})()

```