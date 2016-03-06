'use strict';

var koa = require('koa');
var router = require('koa-router');
var bluebird = require('bluebird');
var redis = require('redis');
var OS = require('opensubtitles-api');
var co = require('co');
var torrent_stream = require('torrent-stream');
var config = require('./config');

var app = koa();
bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

var OpenSubtitles = new OS({
    useragent: config.useragent,
    username: config.username,
    password: config.password,
    ssl: true
});

var os_p = OpenSubtitles.login();

var redis_client = redis.createClient();
redis_client.on("error", function (err) {
    console.log("Error " + err);
});

app.poweredBy = false;

var public_route = new router();
public_route.get('/', function*(next){
    try{
        var self = this;
        if (!('hash' in this.request.query && 'language' in this.request.query && 
                'name' in this.request.query))
        {
            this.status = 400;
            throw 'Bad';
        }
        this.status = 200;
        var redis_p = yield redis_client.getAsync(this.request.query.hash + this.request.query.name);
        if (redis_p != null)
        {
            this.response.body = JSON.parse(redis_p)[this.request.query.language]['url'];
        }
        else
        {
            var link = yield co(function*(){
            yield os_p;
            var subtitles = yield OpenSubtitles.search({
                'filename': self.request.query.name,
                'filesize': self.request.query.size || 0,
                'limit': 3
            });

            var files_p = bluebird.defer();
            
            var torrent_files = torrent_stream(self.request.query.hash)
            torrent_files.on('ready', function(){files_p.resolve()});;
            
            yield files_p.promise;
            for (var file in torrent_files.files)
            {
                if (self.request.query.name == torrent_files.files[file].name)
                {
                    redis_client.set(self.request.query.hash + self.request.query.name, JSON.stringify(subtitles));
                    return subtitles[self.request.query.language].map(function(res){return res['url'];});
                }
            }
            throw 'File not in torrent'; 
            });
            this.response.body = {urls: link};
        }
    }
    catch(err){
        this.status = 404;
        console.error(err);
    }
});

app.use(public_route.middleware());

console.log('Listening on', config.port);
app.listen(config.port);
