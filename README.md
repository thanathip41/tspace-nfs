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
- [Studio](#studio)
- [Images](#images)
- [Example](#example)

## Server
```js
import { NfsServer } from "tspace-nfs";

new NfsServer()
.onLoadBucketLists(async () => {
    // The simple example, you can use any database or another to inform the server about the available bucket lists.
    return await new Promise(r => setTimeout(() => r(['b1','b2']), 200));
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
.onMonitors(async ({ host, memory , cpu }) => {
  console.log({ host,  memory , cpu })
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
  // if using exists will return null if not exists file

  const meta = await nfs.toMeta(fileDirectory)
  
  const base64 = await nfs.toBase64(fileDirectory)

  const stream = await nfs.toStream(fileDirectory)

  const file = req.files.file[0] // assume the file from your upload

  const { path , size , name , url } =  await nfs.save({ // can you use nfs.upload too
    file : file.tempFilePath,
    name : 'my-video.mp4',
    folder : 'my-folder',
    // type : 'stream' | 'form-data' -> default = form-data
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

## Studio
```js
import { NfsServer } from "tspace-nfs";

const server = new NfsServer();

server.useStudio({
    onSetup: () => {
      return {
        logo: {
            index:  `<img width="56" height="56" src="${base64}">`,
            login : `<img class="mx-auto h-20 w-auto" src="${base64}">`,
            fav : `<link rel="icon" type="image/x-icon" href="${favicon}">`
        },
        title : 'Media',
        name : 'NFS-Stdio',
        description: 'NFS-storage'
      }
    },
    onCredentials : async ({ username , password }) => {
      // The simple example, you can use any database or another to a wrapper check the credentials for studio.
      const credentials = [
        {
            username: 'root',
            password: '',
        }
      ]
  
      const find = credentials.find(v => v.username === username && v.password === password )

      return find == null ? false : true,
    },
    onBucketCreated : async ({ username, token , secret , bucket }) => {

      // The simple example, you can use any database or another to store data.
      console.log({
        username, // username from auth, Please do something about owner bucket with username
        token , secret , bucket
      })
    
      return
    },
    onLoadBucketCredentials  : async (username) => {
    // The simple example, you can use any database or another to get the credentials.

    const database = [
      {
        username : 'root',
        token : 'token-dev', 
        secret : 'secret-dev', 
        bucket : 'dev'
      },
      {
        username : 'root2',
        token : 'token-dev', 
        secret : 'secret-dev', 
        bucket : 'dev'
      }
    ]

    // username -> root

    const credentials = database.filter(v => v.username === username).map(v => {
        return {
          token  : v.token,
          secret : v.secret,
          bucket : v.bucket,
        }
      })

      return credentials 
      /** credentials is
        {
          token : 'token-dev', 
          secret : 'secret-dev', 
          bucket : 'dev'
        }
      */
    },
    onLoadPermissions : async (username) => {
      // The simple example, you can use any database or another to get the permission with username.
      console.log(username)
      return { 
        dashbord: true,
        monitors: true,
        requests: true,
        console: true,
      }
    },

    onLoadRequests : async () => {

      // The simple example, you can use any database or another to get the logs.
      const load = [
        {
          date: "2026-01-01T00:00:00.000Z";
          bucket: "dev1";
          count: 500;
        },
        {
          date: "2026-01-01T00:00:00.000Z";
          bucket: "dev2";
          count: 100;
        }
      ]
      
      return load
    },
    onLoadMonitors : async () => {
      
      // The simple example, you can use any database or another to get the logs.
      const load = [
        { 
          host : 'host1', 
          cid  : null,
          rams : { 
            total: 16268.7266, 
            used: 200.2734 ,
            units: { total: 'MB', used: 'MB' 
          },
          cpus : { 
            total: 8, used: 13.118 },
            units: { total: 'cores', used: '%' }
          }
        },
        { 
          host : 'host2', 
          cid  : null,
          rams : { 
            total: 16268.7266, 
            used: 200.2734 ,
            units: { total: 'MB', used: 'MB' 
          },
          cpus : { 
            total: 8, used: 13.118 },
            units: { total: 'cores', used: '%' }
          }
        }
      ];

      return load
    },
})

server.onMonitors(async (monitors) => {
    
    // save to your database or any
    console.log(monitors)

}, 1000 * 60);
  
server.onRequestLogs(async (requests) => {
    if(!requests.length) return

    // save to your database or any
    console.log(requests)
  },1000 * 60 * 3);

server.listen(8000 , ({ port }) => console.log(`Server is running on port http://localhost:${port}/studio`))
```
## Images

Login 'http://localhost:8000/studio' with your credentials in onCredentials  
![NFS Studio](https://raw.githubusercontent.com/thanathip41/tspace-nfs/master/images/nfs-studio.png)

http://localhost:8000/studio/dashboard  
![NFS Studio Dashboard](https://raw.githubusercontent.com/thanathip41/tspace-nfs/master/images/nfs-studio-dashboard.png)

http://localhost:8000/studio/console?cid=<cid>
![NFS Studio Dashboard](https://raw.githubusercontent.com/thanathip41/tspace-nfs/master/images/nfs-studio-console.png)

## Example

[View live source](https://github.com/thanathip41/tspace-nfs/blob/master/example/src/index.ts)
