// The library's data cache, `XmlManager`, is a static list without a lock, and every test shares the one registered host.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
