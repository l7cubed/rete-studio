// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "../src/MyContract.sol";

contract MyContractTest is Test {
    MyContract public myContract;

    function setUp() public {
        myContract = new MyContract();
    }

    function testSetValue() public {
        myContract.setValue(42);
        assertEq(myContract.value(), 42);
    }
}
cast code 0x03D3CE84279cB6F54f5e6074ff0F8319d830dafe
