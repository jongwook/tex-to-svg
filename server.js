var zlib = require('zlib');
var express = require('express');
var crypto = require('crypto');
var cheerio = require('cheerio');
var bodyParser = require('body-parser');
var mathjax = require('mathjax-node');
var mysql = require('mysql2');
var shortid = require('shortid');


var pool = mysql.createPool({
  connectionLimit: 10,
  host: 'localhost',
  user: 'tex',
  password: 'tex',
  database: 'tex',
  namedPlaceholders: true
});

/** returns SHA-256 hash of given data in binary format */
function sha256(data) {
  var sha = crypto.createHash('sha256');
  sha.update(data);
  return new Buffer(sha.digest('binary'), 'binary');
}

function toSVG(html) {
  var $ = cheerio.load(html, {lowerCaseAttributeNames: false});
  var glyphs = $('#MathJax_SVG_glyphs');
  var span = $("#MathJax-Element-1-Frame");
  var child = span.children();
  child.attr("xmlns", "http://www.w3.org/2000/svg");
  child.prepend(glyphs);
  return cheerio.html(child);
}

var app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

app.post('/api/create', function (req, res) {
  var ip = req.get('X-Forwarded-For') || req.ip;
  var tex = req.body.tex;

  mathjax.typeset({
    html: tex,
    renderer: "SVG",
    inputs: ["TeX"],
    xmlns: "svg"
  }, function(result) {
    if (result && result.html) {
      var svg = toSVG(result.html);
      var hash = sha256(svg);
      pool.execute('SELECT id FROM equations WHERE hash = :hash', {hash: hash}, function (err, rows) {
        if (err) {
          res.status(500).send(err.toString());
        } else {
          if (rows.length > 0) {
            // found the same one
            res.json({id: rows[0].id});
          } else {
            // have to save one
            var id = shortid.generate();
            pool.execute('INSERT INTO equations (id, hash, tex, svgz, ip, timestamp) VALUES (:id, :hash, :tex, :svgz, :ip, :timestamp)', {
              id: id, hash: hash, tex: tex, svgz: zlib.gzipSync(svg), ip: ip, timestamp: Date.now()
            }, function (err, rows) {
              if (err) {
                res.status(500).send(err.toString());
              } else {
                res.json({id: id});
              }
            });
          }
        }
      })
    } else {
      res.status(500).send('MathJaX error');
    }
  });
});

app.get('/svg/:id', function (req, res) {
  pool.execute('SELECT svgz FROM equations WHERE id = :id', {id: req.params.id}, function (err, rows) {
    if (err) {
      res.status(500).send(err.toString());
    } else if (rows.length == 0) {
      res.status(404).send(req.params.id + " not found");
    } else {
      res.set('Content-Type', 'image/svg+xml');
      res.set('Content-Encoding', 'gzip');
      res.send(rows[0].svgz);
    }
  });
});

app.use(express.static('public'));

var port = process.env.PORT || 1337;
var server = app.listen(port, function () {
  var host = server.address().address;
  var port = server.address().port;

  console.log('tex-to-svg server listening at http://%s:%s', host, port);
});
