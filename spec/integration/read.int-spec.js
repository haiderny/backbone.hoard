'use strict';

var _ = require('underscore');
var Backbone = require('backbone');
var Hoard = require('src/backbone.hoard');

module.exports = function (storageName, storage) {
  describe("Reading with " + storageName, function () {
    beforeEach(function () {
      this.sinon.stub(Hoard, 'backend', storage);
      this.control = new Hoard.Control();
      this.sync = this.control.getModelSync();
    });

    afterEach(function () {
      return storage.clear();
    });

    describe("when reading a model", function () {
      beforeEach(function () {
        this.Model = Backbone.Model.extend({
          idAttribute: 'id',
          url: function () {
            return '/id-plus-one/' + this.get('id');
          },
          sync: this.sync
        });

        this.endpoint = /\/id-plus-one\/(.+)/;
        this.server.respondWith('GET', this.endpoint, function (xhr) {
          this.storeRequest(xhr);
          var id = +xhr.url.match(this.endpoint)[1];
          var value = id + 1;

          if (isNaN(value)) {
            xhr.respond(400, { 'Content-Type': 'application/json' }, JSON.stringify({
              id: id,
              value: 'Feed me numbers'
            }));
          } else {
            xhr.respond(200, { 'Content-Type': 'application/json' }, JSON.stringify({
              id: id,
              value: value
            }));
          }
        }.bind(this));
      });

      describe("multiple times from the same url", function () {
        beforeEach(function () {
          this.m1 = new this.Model({ id: 1 });
          this.m2 = new this.Model({ id: 1 });
        });

        describe("synchronously", function () {
          beforeEach(function () {
            this.m1Promise = this.m1.fetch();
            this.m2Promise = this.m2.fetch();
            return Promise.all([this.m1Promise, this.m2Promise]);
          });

          it("populates all the models with the response", function () {
            expect(this.m1.get('value')).to.equal(2);
            expect(this.m2.get('value')).to.equal(2);
          });

          it("only calls the server once", function () {
            expect(this.requests['GET:/id-plus-one/1']).to.have.length(1);
          });

          it("doesn't call the server again on subsequent calls", function () {
            var m3 = new this.Model({ id: 1 });
            return m3.fetch().then(function () {
              expect(m3.get('value')).to.equal(2);
              expect(this.requests['GET:/id-plus-one/1']).to.have.length(1);
            }.bind(this));
          });

          it("populates the cache", function () {
            var storedItem = storage.getItem('/id-plus-one/1');
            var expectedJSON = JSON.stringify({id: 1, value: 2});

            //account for synchronous and asynchronous storage
            if (storedItem.then) {
              return expect(storedItem).to.eventually.equal(expectedJSON);
            } else {
              expect(storedItem).to.equal(expectedJSON);
            }
          });
        });

        describe("asynchronously", function () {
          beforeEach(function () {
            var d1 = Hoard.defer();
            var d2 = Hoard.defer();

            _.defer(function () {
              this.m1Promise = this.m1.fetch();
              d1.resolve();
            }.bind(this));

            _.defer(function () {
              this.m2Promise = this.m2.fetch();
              d2.resolve();
            }.bind(this));

            return Promise.all([d1.promise, d2.promise]).then(function () {
              return Promise.all([this.m1Promise, this.m2Promise]);
            }.bind(this));
          });

          it("populates the models with the response", function () {
            expect(this.m1.get('value')).to.equal(2);
            expect(this.m2.get('value')).to.equal(2);
          });
          
          it("resolves the non-cached fetch promise with all the original sync promise resolution arguments", function () {
              return this.m1Promise.then(function (responseArgs) {
                expect(responseArgs.length).to.equal(3);
                expect(responseArgs[0]).to.eql(this.m1.toJSON());
                expect(responseArgs[1]).to.equal('success');
                expect(responseArgs[2].status).to.equal(200);
              }.bind(this));
          });
          
          it("resolves the placeholder fetch promise with all the original sync promise resolution arguments", function () {
              return this.m2Promise.then(function (responseArgs) {
                expect(responseArgs.length).to.equal(3);
                expect(responseArgs[0]).to.eql(this.m1.toJSON());
                expect(responseArgs[1]).to.equal('success');
                expect(responseArgs[2].status).to.equal(200);
              }.bind(this));
          });

          it("only calls the server once", function () {
            expect(this.requests['GET:/id-plus-one/1']).to.have.length(1);
          });
        });

        describe("with a warmed cache", function () {
          beforeEach(function () {
            return this.control.store.set(this.m1.url(), { id: 1, value: 2 }).then(function () {
              this.m1Promise = this.m1.fetch();
              this.m2Promise = this.m2.fetch();
              return Promise.all([this.m1Promise, this.m2Promise]);
            }.bind(this));
          });

          it("populates the models with the response", function () {
            expect(this.m1.get('value')).to.equal(2);
            expect(this.m2.get('value')).to.equal(2);
          });

          it("doesn't call the server", function () {
            expect(this.requests['GET:/id-plus-one/1']).not.to.exist;
          });

          it("resolves the fetch promise with an array of just the cached response", function () {
            return this.m2Promise.then(function (responseArgs) {
              expect(responseArgs.length).to.equal(1);
              expect(responseArgs[0].value).to.equal(2);
            }.bind(this));
          });

        });
      });

      describe("when the request fails", function () {
        beforeEach(function () {
          this.notANumber = 'not-a-number';
          this.m1 = new this.Model({ id: this.notANumber });
          this.m2 = new this.Model({ id: this.notANumber });
          return this.m1.fetch().catch(function () {
            return this.m2.fetch();
          }.bind(this)).catch(function () {});
        });

        it("does not populate the models", function () {
          expect(this.m1.get('value')).to.be.undefined;
          expect(this.m2.get('value')).to.be.undefined;
        });

        it("makes multiple calls to the server", function () {
          expect(this.requests['GET:/id-plus-one/not-a-number']).to.have.length(2);
        });
      });

      describe("when the cached value should be evicted", function () {
        beforeEach(function () {
          this.key = '/id-plus-one/1';
          this.control.policy.shouldEvictItem = function () {
            return true;
          };
          return this.control.store.set(this.key, {id: 1, value: 'super-value'})
            .then(function () {
            return this.control.store.metaStore.set(this.key, {});
          }.bind(this))
            .then(function () {
            this.m1 = new this.Model({id: 1});
            return this.m1.fetch();
          }.bind(this));
        });

        it("sets it's value to the server response", function () {
          expect(this.m1.get('value')).to.equal(2);
        });

        it("sets the cache to the new value", function () {
          return expect(this.control.store.get(this.key)).to.eventually.eql({ id: 1, value: 2 });
        });
      });

      describe("when the url for the given model changes mid-execution", function () {
        beforeEach(function () {
          this.m1 = new this.Model({ id: 1 });
          var fetch = this.m1.fetch();
          this.m1.set('id', 2);
          return fetch;
        });

        it("uses the url for the model at the start of execution", function () {
          expect(this.requests['GET:/id-plus-one/1']).to.have.length(1);
          expect(this.requests['GET:/id-plus-one/2']).to.be.undefined;
        });
      });

      describe("when the cache is full", function () {
        beforeEach(function () {
          this.key = 'key';
          return this.control.store.set(this.key, { id: 1, value: 'super-value' }).then(function () {
            this.sinon.stub(Hoard.backend, 'setItem').throws();
            this.m1 = new this.Model({ id: 1 });
            this.m2 = new this.Model({ id: 1 });
            return Hoard.Promise.all([this.m1.fetch(), this.m2.fetch()]);
          }.bind(this));
        });

        // This test depends on a newly deferred function being placed at the end of
        // the line for execution. This is possibly dependent on the execution environment,
        // and this test should be made more robust
        // (possibly through hooks in the code under test) if it ever breaks.
        it("clears the cache", function (done) {
          _.defer(function () {
            expect(this.control.store.get(this.key)).to.be.rejected;
            done();
          }.bind(this));
        });

        it("populates the model", function () {
          expect(this.m1.get('value')).to.equal(2);
          expect(this.m2.get('value')).to.equal(2);
        });

        it("only calls the server once", function () {
          expect(this.requests['GET:/id-plus-one/1']).to.have.length(1);
        });
      });

      describe("when the model belongs to a collection", function () {
        beforeEach(function () {
          this.collectionKey = '/collection';
          this.model = new this.Model({ id: 1 });
          this.Collection = Backbone.Collection.extend({
            url: this.collectionKey,
            sync: this.sync
          });
          this.collection = new this.Collection();

          this.server.respondWith('GET', '/collection', function (xhr) {
            this.storeRequest(xhr);
            xhr.respond(200, { 'Content-Type': 'application/json' }, JSON.stringify([]));
          }.bind(this));

          return this.collection.fetch().then(function () {
            this.collection.add(this.model);
            return this.model.fetch();
          }.bind(this));
        });

        it("adds the model under the collection's key", function () {
          return this.control.store.get(this.collectionKey).then(function (collection) {
            expect(_.first(collection)).to.deep.eql(this.model.toJSON());
          }.bind(this));
        });

        it("can recover the model from the cache", function () {
          var model = new this.Model({ id: 1 });
          var collection = new this.Collection(model);
          return model.fetch().then(function () {
            expect(model.toJSON()).to.deep.eql(this.model.toJSON());
            expect(collection.toJSON()).to.deep.eql(this.collection.toJSON());
            expect(this.requests['GET:/id-plus-one/1']).to.have.length(1);
          }.bind(this));
        });
      });

    });

    describe("when reading a collection", function () {
      beforeEach(function () {
        this.modelRoot = '/model';
        this.Model = Backbone.Model.extend({
          urlRoot: this.modelRoot
        });

        this.collectionUrl = '/collection';
        this.Collection = Backbone.Collection.extend({
          model: this.Model,
          url: this.collectionUrl,
          sync: this.sync
        });

        this.server.respondWith('GET', this.collectionUrl, function (xhr) {
          xhr.respond(200, { 'Content-Type': 'application/json' }, JSON.stringify([
            { id: 1 }
          ]));
        });
      });

      it("(#43) does not override the model's url", function () {
        this.collection = new this.Collection();
        return this.collection.fetch().then(function () {
          expect(this.collection.get(1).url()).to.equal(this.modelRoot + '/1');
        }.bind(this));
      });
    });
  });
};
