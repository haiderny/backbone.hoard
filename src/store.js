'use strict';

var _ = require('underscore');
var Hoard = require('./backbone.hoard');

var mergeOptions = ['backend'];

var Store = function (options) {
  _.extend(this, _.pick(options || {}, mergeOptions));
  _.defaults(this, { backend: Hoard.backend });
  this.initialize.apply(this, arguments);
};

_.extend(Store.prototype, Hoard.Events, {
  initialize: function () {},

  set: function (key, value, options) {
    var deferred = Hoard.deferred();
    var valueToStore = JSON.stringify(value);
    try {
      this.backend.setItem(key, valueToStore);
      deferred.resolve();
    } catch(e) {
      deferred.reject(e);
    }
    return deferred.promise;
  },

  get: function (key, options) {
    var deferred = Hoard.deferred();
    var storedValue = JSON.parse(this.backend.getItem(key));
    if (storedValue !== null) {
      deferred.resolve(storedValue);
    } else {
      deferred.reject();
    }
    return deferred.promise;
  },

  invalidate: function (key) {
    var deferred = Hoard.deferred();
    this.backend.removeItem(key);
    deferred.resolve();
    return deferred.promise;
  }
});

Store.extend = Hoard.extend;

module.exports = Store;
