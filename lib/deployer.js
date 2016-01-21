var fs = require('fs'),
	child_process = require('child_process'),
	path = require('path'),
	generator = require('./generator');

var hexo,
	baseDir,
	publicDir,
	deployDir,
	spawnSettings,
	git,
	fs_stat,
	fs_mkdirs,
	fs_copy,
	fs_walk,
	fs_copyDir,
	fs_rmdir,
	fs_writeFile,
	git;

spawnSettings = {};

fs.walk = function (path, opt) {
	return new Promise(function (resolve) {
		path = Path.normalize(path);
		var _files = [];
		opt = opt || {};
		fs.readdir(path, function (err, files) {
			var len = files.length,
				i = 0;
			if (len === 0) {
				resolve([]);
			}
			files.each({
				func: function (val, idx, arr, finish) {
					var _path = Path.join(path, val);
					fs.stat(_path, function (err, stat) {
						if (stat.isDirectory()) {
							fs.walk(_path)
								.then(function (__files) {
									_files = _files.concat(__files);
									finish();
								});
						} else {
							_files.push(_path);
							finish();
						}
					})
				},
				ondone: function () {
					resolve(_files);
				}
			});
		});
	});
};

fs.mkdirs = function (dir) {
	return new Promise(function (resolve) {
		fs.mkdir(dir, function (err) {
			if (err) {
				switch (err.code) {
				case 'ENOENT':
					fs.mkdirs(Path.resolve(dir, '../'))
						.then(function () {
							fs.mkdir(dir, resolve);
						});
					break;
				default:
					resolve();
				}
			} else {
				resolve();
			}
		});
	});
};

fs.copy = function (src, dest) {
	return new Promise(function (resolve, reject) {
		fs.mkdirs(path.dirname(dest))
			.then(function () {
				var ws = fs.createWriteStream(dest);
				ws.on('finish', resolve);
				fs.createReadStream(src)
					.pipe(ws);
			});
	});
};

path.include = function (parent, child) {
	return !path.relative(parent, child).startsWith('../');
}

fs.copyDir = function (src, dir, opt) {
	opt = opt || {};
	return new Promise(function (resolve, reject) {
		fs.walk(src)
			.then(function (files) {
				return Promise.all(
					files
					.filter(function (val) {
						var len = opt.exclude_path.length;
						while (len--) {
							if (path.include(opt.exclude_path[len], val)) {
								return false;
							}
						}
						return true;
					})
					.map(function (val) {
						return new Promise(function (resolve, reject) {
							fs.copy(val, path.join(dir, path.relative(src, val)))
								.then(resolve);
						});
					})
				);
			})
			.then(resolve);
	});
};

fs.emptyDirSync = function (dir, opt) {
	var files = fs.readdirSync(dir);
	var ignoreDotFiles = (function (opt) {
		if (opt.ignoreDotFiles) {
			return function (fn) {
				return fn[0] !== '.';
			}
		}
		return function () {
			return true;
		};
	})(opt);
	files.filter(ignoreDotFiles)
		.map(function (val) {
			var _path = path.join(dir, val),
				stat = fs.statSync(_path);
			return {
				path: _path,
				isDir: stat.isDirectory()
			}
		}).filter(function (val) {
			if (!val.isDir) {
				fs.unlinkSync(val.path);
				return
			}
			return val.isDir;
		}).forEach(function (val) {
			fs.emptyDirSync(val.path, opt);
			fs.rmdirSync(val.path);
		});
};

fs_stat = generator.generify(fs.stat);
fs_mkdirs = generator.generify(function (dir, cb) {
	fs.mkdirs(dir)
		.then(cb);
});
fs_copy = generator.generify(function (src, dest, cb) {
	fs.copy(src, dest)
		.then(cb);
});
fs_walk = generator.generify(function (dir, cb) {
	fs.walk(dir)
		.then(cb);
});
fs_copyDir = generator.generify(function (src, dest, opt, cb) {
	fs.copyDir(src, dest, opt)
		.then(cb)
});
fs_rmdir = generator.generify(function (dir, cb) {
	fs.rmdir(dir, cb);
});
fs_writeFile = generator.generify(fs.writeFile);

git = generator.generify(function () {
	var len = arguments.length,
		args = new Array(len),
		timer;
	for (var i = 0; i < len; i++) {
		args[i] = arguments[i];
	}
	var cb = args.pop();
	console.log('git', arguments[0]);
	child_process.spawn('git', args, spawnSettings)
		.on('close', function () {
			cb.call(null);
			clearInterval(timer);
			process.stdout.write('\n');
		});
	timer = setInterval(function () {
		process.stdout.write('.');
	}, 300);
});

exports.deploy = function (_hexo) {
	hexo = _hexo;
	generator.future(function* () {
		var stat,
			files,
			rel;
		baseDir = hexo.base_dir;
		publicDir = path.join(baseDir, hexo.config.public_dir);
		deployDir = path.join(baseDir, hexo.config.deploy_dir);
		spawnSettings.cwd = deployDir;
		spawnSettings.verbose = true;

		stat = yield fs_stat(path.join(baseDir, hexo.config.deploy_dir));
		if (stat instanceof Error) {
			yield fs_mkdirs(hexo.config.deploy_dir)
			yield fs_writeFile(path.join(deployDir, 'placeholder'), '');
			yield git('init');
			yield git('add', '-A');
			yield git('commit', '-m', 'First commit');
		} else {
			fs.emptyDirSync(deployDir, {
				ignoreDotFiles: true
			});
		}
		var ignoredir = [
			path.join(baseDir, hexo.config.public_dir, 'src', 'bussiness')
		];
		yield fs_copyDir(publicDir, deployDir, {
			exclude_path: hexo.config.environment === 'internal' ? [] : ignoredir
		});
		yield git('add', '-A');
		yield git('commit', '-m', 'Site updated at ' + new Date());
		yield git('push', '-u', hexo.config.repo, 'master:gh-pages', '--force');
	});
};